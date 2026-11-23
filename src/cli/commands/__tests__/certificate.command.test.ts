import { Command } from 'commander';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../lib/errors/app-error';
import { stripAnsi } from '../../../ui';
import { confirm } from '../../interactive/prompts';
import { registerCertificateCommand } from '../certificate.command';

const generate = vi.hoisted(() => vi.fn());
const importCertificate = vi.hoisted(() => vi.fn());
const config = vi.hoisted(() => ({ entornoPorDefecto: 'testing', jsonPorDefecto: false }));

vi.mock('../../../modules/certificates/certificate.service', () => ({
  CertificateService: class {
    public generate = generate;
    public import = importCertificate;
  },
}));

vi.mock('../../../modules/config/config.service', () => ({
  ConfigService: class {
    public close() {}
    public getCertificatesPath() {
      return '/tmp/certificados';
    }
    public getConfig() {
      return { entornoPorDefecto: config.entornoPorDefecto, output: { jsonPorDefecto: config.jsonPorDefecto } };
    }
  },
}));

vi.mock('../../interactive/prompts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../interactive/prompts')>()),
  confirm: vi.fn(),
}));

const REQUEST = {
  alias: 'arcli',
  csrPem: '-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----',
  cuit: '20111111112',
  environment: 'testing',
  keyPath: '/tmp/certificados/testing/pedido.key',
  requestPath: '/tmp/certificados/testing/pedido.csr',
};

const IMPORTED = {
  alias: 'arcli',
  certificatePath: '/tmp/certificados/testing/arcli.crt',
  cuit: '20111111112',
  environment: 'testing',
  expiresAt: new Date('2027-11-17T00:00:00Z'),
  keyPath: '/tmp/certificados/testing/arcli.key',
  replaced: false,
};

const replaceConfirmation = () =>
  new AppError('Ya hay un certificado de testing configurado, que vence el 01/01/2027.', {
    code: 'CERTIFICATE_REPLACE_CONFIRMATION',
  });

const crtFile = (() => {
  const folder = mkdtempSync(join(tmpdir(), 'arcli-crt-'));
  const path = join(folder, 'nuevo.crt');

  writeFileSync(path, '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n');

  return path;
})();

async function run(argv: string[]): Promise<{ error?: unknown; stdout: string }> {
  const program = new Command().exitOverride();

  registerCertificateCommand(program);

  try {
    await program.parseAsync(['node', 'arcli', ...argv]);

    return { stdout: stdout() };
  } catch (error) {
    return { error, stdout: stdout() };
  }
}

function stdout(): string {
  return stripAnsi(
    vi
      .mocked(process.stdout.write)
      .mock.calls.map(([chunk]) => String(chunk))
      .join(''),
  );
}

describe('arcli certificado', () => {
  let tty: { stdin?: boolean; stdout?: boolean };

  beforeEach(() => {
    tty = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY };
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.stdin.isTTY = tty.stdin as boolean;
    process.stdout.isTTY = tty.stdout as boolean;
    config.entornoPorDefecto = 'testing';
    config.jsonPorDefecto = false;
    vi.restoreAllMocks();
    generate.mockReset();
    importCertificate.mockReset();
    vi.mocked(confirm).mockReset();
  });

  describe('generar', () => {
    it('sin flags usa el entorno de la config; --testing y --produccion lo eligen', async () => {
      generate.mockReturnValue(REQUEST);
      config.entornoPorDefecto = 'produccion';

      await run(['certificado', 'generar']);
      await run(['certificado', 'generar', '--testing', '--alias', 'mio']);
      await run(['certificado', 'generar', '--produccion', '--reemplazar']);

      expect(generate.mock.calls.map(([options]) => options)).toEqual([
        { alias: undefined, environment: 'produccion', replace: false },
        { alias: 'mio', environment: 'testing', replace: false },
        { alias: undefined, environment: 'produccion', replace: true },
      ]);
    });

    it('en texto muestra el pedido; con --json o `json` en la config, el JSON', async () => {
      generate.mockReturnValue(REQUEST);

      const text = (await run(['certificado', 'generar'])).stdout;

      expect(text).toContain('PEDIDO DE CERTIFICADO · TESTING');
      expect(text).toContain('20-11111111-2');
      expect(() => JSON.parse(text)).toThrow();

      vi.mocked(process.stdout.write).mockClear();
      config.jsonPorDefecto = true;

      expect(JSON.parse((await run(['certificado', 'generar'])).stdout)).toMatchObject({
        alias: 'arcli',
        cuit: '20111111112',
        entorno: 'testing',
        rutaCsr: REQUEST.requestPath,
      });
    });
  });

  describe('importar', () => {
    it('sin terminal no pregunta: el pedido de reemplazo sale como error', async () => {
      process.stdin.isTTY = false as never;
      importCertificate.mockImplementationOnce(() => {
        throw replaceConfirmation();
      });

      const { error } = await run(['certificado', 'importar', crtFile]);

      expect(error).toMatchObject({ code: 'CERTIFICATE_REPLACE_CONFIRMATION' });
      expect(confirm).not.toHaveBeenCalled();
    });

    it('en una terminal pregunta antes de reemplazar y, si se confirma, lo reemplaza', async () => {
      process.stdin.isTTY = true;
      process.stdout.isTTY = true;
      importCertificate
        .mockImplementationOnce(() => {
          throw replaceConfirmation();
        })
        .mockReturnValueOnce({ ...IMPORTED, replaced: true });
      vi.mocked(confirm).mockResolvedValueOnce(true);

      const { error, stdout: printed } = await run(['certificado', 'importar', crtFile]);

      expect(error).toBeUndefined();
      expect(importCertificate.mock.calls[1]?.[0]).toMatchObject({ replace: true });
      expect(printed).toContain('Ya hay un certificado de testing configurado');
      expect(printed).toContain('(reemplaza al anterior)');
    });

    it('"No, dejar el actual" o Ctrl+C dejan el certificado y salen con el pedido de reemplazo', async () => {
      process.stdin.isTTY = true;
      process.stdout.isTTY = true;
      importCertificate.mockImplementation(() => {
        throw replaceConfirmation();
      });
      vi.mocked(confirm)
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(Object.assign(new Error('Ctrl+C'), { name: 'ExitPromptError' }));

      expect((await run(['certificado', 'importar', crtFile])).error).toMatchObject({
        code: 'CERTIFICATE_REPLACE_CONFIRMATION',
      });
      expect((await run(['certificado', 'importar', crtFile])).error).toMatchObject({
        code: 'CERTIFICATE_REPLACE_CONFIRMATION',
      });
      expect(importCertificate).toHaveBeenCalledTimes(2);
    });

    it('un error del prompt que no es Ctrl+C sale tal cual', async () => {
      process.stdin.isTTY = true;
      process.stdout.isTTY = true;
      importCertificate.mockImplementationOnce(() => {
        throw replaceConfirmation();
      });
      vi.mocked(confirm).mockRejectedValueOnce(new Error('stdin cerrado'));

      expect((await run(['certificado', 'importar', crtFile])).error).toMatchObject({ message: 'stdin cerrado' });
    });

    it('con --json no pregunta aunque haya terminal', async () => {
      process.stdin.isTTY = true;
      process.stdout.isTTY = true;
      importCertificate.mockImplementationOnce(() => {
        throw replaceConfirmation();
      });

      expect((await run(['certificado', 'importar', crtFile, '--json'])).error).toMatchObject({
        code: 'CERTIFICATE_REPLACE_CONFIRMATION',
      });
      expect(confirm).not.toHaveBeenCalled();
    });

    it('otro error del certificado no pregunta nada', async () => {
      process.stdin.isTTY = true;
      process.stdout.isTTY = true;
      importCertificate.mockImplementationOnce(() => {
        throw new AppError('El certificado venció.', { code: 'CERTIFICATE_EXPIRED' });
      });

      expect((await run(['certificado', 'importar', crtFile])).error).toMatchObject({ code: 'CERTIFICATE_EXPIRED' });
      expect(confirm).not.toHaveBeenCalled();
    });

    it('--reemplazar y el entorno van al servicio; con --json sale el JSON', async () => {
      importCertificate.mockReturnValueOnce(IMPORTED);

      const { stdout: printed } = await run([
        'certificado',
        'importar',
        crtFile,
        '--produccion',
        '--reemplazar',
        '--json',
      ]);

      expect(importCertificate.mock.calls[0]?.[0]).toMatchObject({ environment: 'produccion', replace: true });
      expect(JSON.parse(printed)).toEqual({
        alias: 'arcli',
        cuit: '20111111112',
        entorno: 'testing',
        reemplazado: false,
        rutaCertificado: IMPORTED.certificatePath,
        rutaClave: IMPORTED.keyPath,
        vence: '2027-11-17T00:00:00.000Z',
      });
    });

    it('--testing y --produccion juntos: INPUT_VALIDATION_ERROR, sin importar nada', async () => {
      const { error } = await run(['certificado', 'importar', crtFile, '--testing', '--produccion']);

      expect(error).toMatchObject({
        code: 'INPUT_VALIDATION_ERROR',
        message: 'Usá `--testing` o `--produccion`, pero no ambos a la vez.',
      });
      expect(importCertificate).not.toHaveBeenCalled();
    });

    it('un archivo que no se puede leer avisa con la ruta', async () => {
      const { error } = await run(['certificado', 'importar', join(tmpdir(), 'no-existe', 'x.crt')]);

      expect(error).toMatchObject({ code: 'INPUT_VALIDATION_ERROR' });
      expect((error as Error).message).toMatch(/No se puede leer el certificado: .*x\.crt\./);
      expect(importCertificate).not.toHaveBeenCalled();
    });
  });
});
