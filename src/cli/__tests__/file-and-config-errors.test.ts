import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSelfSignedCertificate,
  OPENSSL_WARM_UP_TIMEOUT_MS,
  removeSelfSignedCertificates,
  type SelfSignedCertificate,
} from '../../lib/security/__tests__/self-signed-certificate';
import { toBatchItemError } from '../../modules/billing/billing.batch';
import { stripAnsi } from '../../ui';
import { formatCliError, reportCliError } from '../error-output';
import { showAssistantError } from '../interactive/show-assistant-error';
import { createProgram } from '../program';

/** ERR-4 y ERR-8, por el comando real con una config temporal. Todo falla antes de la red. */

/** Root puede con todo y Windows no tiene estos permisos. */
const withPermissions = process.platform !== 'win32' && process.getuid?.() !== 0;

let certificate: SelfSignedCertificate;
let directory = '';
let root = '';

interface JsonError {
  readonly codigo: string;
  readonly detalles: unknown;
  readonly error: string;
  readonly sugerencia: string | null;
}

async function fail(...args: string[]): Promise<{ readonly json: JsonError; readonly text: string }> {
  let stderr = '';
  let thrown: unknown;
  const write = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);

    return true;
  });

  try {
    await createProgram().parseAsync(['node', 'arcli', ...args]);
  } catch (error) {
    thrown = error;
    expect(reportCliError(error, true)).toBe(1);
  } finally {
    write.mockRestore();
  }

  expect(thrown).toBeDefined();

  return {
    json: JSON.parse(stderr) as JsonError,
    text: stripAnsi(formatCliError(thrown, false)).replace(/[│┃║╏\s]+/g, ' '),
  };
}

function saveConfig(config: unknown): string {
  const path = join(directory, 'config.json');

  writeFileSync(path, JSON.stringify(config));

  return path;
}

/** La E arma el perfil antes de leer el archivo: necesita CUIT y certificado. */
function saveProfile(): void {
  saveConfig({
    cert: { testing: certificate.certPath },
    cuit: '20123456786',
    key: { testing: certificate.keyPath },
  });
}

beforeAll(() => {
  certificate = createSelfSignedCertificate(365);
}, OPENSSL_WARM_UP_TIMEOUT_MS);

afterAll(removeSelfSignedCertificates);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arcli-archivos-'));
  // Varias carpetas adentro: en Linux, /tmp/x entera es tan corta como la abreviada.
  directory = join(root, 'uno', 'dos');
  mkdirSync(directory, { recursive: true });
  vi.stubEnv('ARCLI_CONFIG_DIR', directory);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  rmSync(root, { force: true, recursive: true });
});

const COMMANDS: ReadonlyArray<readonly [string, string[]]> = [
  ['estado', ['estado']],
  ['config', ['config']],
  ['config revisar', ['config', 'revisar']],
  ['config establecer de otra clave', ['config', 'establecer', 'alicuota', '21']],
  ['fc', ['fc', '-m', '1000', '--cs', '--cfinal', '--pv', '1']],
  ['fe', ['fe', '--pv', '1']],
];

describe('config guardada con datos inválidos (ERR-4)', () => {
  describe.each(COMMANDS)('%s', (_name, args) => {
    it.each([
      [{ cuit: '123' }, 'cuit', 'el CUIT debe tener 11 dígitos.', 'El CUIT debe tener 11 dígitos', ['cuit']],
      [
        { entornoPorDefecto: 'x' },
        'entorno',
        'tiene un valor no soportado. Valores válidos: testing, produccion.',
        '`entornoPorDefecto` tiene un valor no soportado. Valores válidos: testing, produccion.',
        ['entornoPorDefecto'],
      ],
      [
        { puntoVentaPorDefecto: 'a' },
        'puntoVenta',
        'tiene que ser un número.',
        '`puntoVentaPorDefecto` tiene que ser un número.',
        ['puntoVentaPorDefecto'],
      ],
    ])('%j', async (config, key, reason, mensaje, ruta) => {
      saveConfig(config);

      const { json, text } = await fail(...args);

      expect(json).toEqual({
        codigo: 'INPUT_VALIDATION_ERROR',
        detalles: [{ mensaje, ruta }],
        error: `La configuración guardada tiene un dato inválido. \`${key}\`: ${reason}`,
        sugerencia: `Corregilo con \`arcli config establecer ${key} <valor>\` o borralo con \`arcli config eliminar ${key}\`.`,
      });
      expect(text).toContain('configuración guardada');
      expect(text).toContain(`arcli config establecer ${key}`);
      expect(text).not.toContain('PorDefecto');
    });

    it('varias a la vez: las nombra, y como de a una no se pueden guardar, manda al archivo', async () => {
      const path = saveConfig({ cuit: '123', entornoPorDefecto: 'x' });
      const { json } = await fail(...args);

      expect(json.codigo).toBe('INPUT_VALIDATION_ERROR');
      expect(json.detalles).toEqual([
        { mensaje: 'El CUIT debe tener 11 dígitos', ruta: ['cuit'] },
        {
          mensaje: '`entornoPorDefecto` tiene un valor no soportado. Valores válidos: testing, produccion.',
          ruta: ['entornoPorDefecto'],
        },
      ]);
      expect(json.error).toBe(
        'La configuración guardada tiene datos inválidos. `cuit`: el CUIT debe tener 11 dígitos. `entorno`: tiene un valor no soportado. Valores válidos: testing, produccion.',
      );
      expect(json.sugerencia).toContain(path);
      expect(json.sugerencia).toContain('arcli config establecer');
      expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ cuit: '123', entornoPorDefecto: 'x' });
    });
  });

  it.each([
    [{ emisor: 'x' }, '`emisor`', 'arcli config establecer emisor.condicionIva <valor>'],
    [{ emisor: { logo: '' } }, '`emisor.logo`', 'arcli config eliminar emisor.logo'],
    [{ output: 3 }, '`emitir`, `json`, `bruto`', 'arcli config establecer emitir <valor>'],
    [
      { comprobantesPorLista: 0 },
      '`comprobantesPorLista`',
      'Corregilo con `arcli config establecer filasPorLista <valor>`.',
    ],
  ])('un grupo, una clave adentro de otra y una deprecada: %j', async (config, key, command) => {
    saveConfig(config);

    const { json } = await fail('config');

    expect(json.error).toContain(`${key}: `);
    expect(json.sugerencia).toContain(command);
  });

  it('con una arreglada y otra rota en el archivo, no manda a un comando que tampoco puede guardar', async () => {
    const path = saveConfig({ cuit: '123', entornoPorDefecto: 'x' });
    const { json } = await fail('config', 'establecer', 'cuit', '20168598204');

    expect(json.error).toBe(
      'La configuración guardada tiene un dato inválido. `entorno`: tiene un valor no soportado. Valores válidos: testing, produccion.',
    );
    expect(json.sugerencia).toContain(path);
  });

  it('un valor malo recién pasado no dice "guardada", tampoco con otra clave rota', async () => {
    for (const config of [{}, { entornoPorDefecto: 'x' }]) {
      saveConfig(config);

      const { json } = await fail('config', 'establecer', 'cuit', '123');

      expect(json.error).toMatch(/^El CUIT "123" no es válido/);
      expect(json.error).not.toContain('guardada');
    }
  });

  it('establecer o eliminar la clave rota la repara, como dice la sugerencia', async () => {
    for (const args of [
      ['establecer', 'entorno', 'testing'],
      ['eliminar', 'entorno'],
    ]) {
      saveConfig({ entornoPorDefecto: 'x' });
      await createProgram().parseAsync(['node', 'arcli', 'config', ...args]);

      expect(JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8'))).toMatchObject({
        entornoPorDefecto: 'testing',
      });
    }
  });

  it.each([[[]], [null]])('%j como config sigue pidiendo el CUIT', async (config) => {
    saveConfig(config);

    expect((await fail('estado')).json).toMatchObject({
      codigo: 'CONFIGURATION_ERROR',
      error: expect.stringContaining('Falta el CUIT'),
    });
  });
});

describe('errores de archivos (ERR-8)', () => {
  function expectFileError({ json, text }: Awaited<ReturnType<typeof fail>>, message: RegExp): void {
    expect(json).toMatchObject({ codigo: 'UNEXPECTED_ERROR', detalles: null });
    expect(json.error).toMatch(message);
    expect(json.sugerencia).toMatch(/^[A-ZÁ].*\.$/);
    expect(JSON.stringify(json)).not.toContain(directory);
    expect(JSON.stringify(json)).not.toMatch(/E[A-Z]{4,}: |denied|illegal/);
    expect(text).toContain('No se pudo');
    expect(text).toContain('Sugerencia');
  }

  it('--cargar una carpeta, en A/B/C y en la E', async () => {
    saveProfile();

    for (const command of ['fc', 'fe']) {
      expectFileError(await fail(command, '--cargar', directory), /^No se pudo leer \.\.\.\/.+: es una carpeta\.$/);
    }
  });

  it('config establecer key.testing con una carpeta', async () => {
    const folder = join(directory, 'clave');

    mkdirSync(folder);
    expectFileError(
      await fail('config', 'establecer', 'key.testing', folder),
      /^No se pudo leer \.\.\.\/.+\/clave: es una carpeta\.$/,
    );
  });

  it('config.json es una carpeta', async () => {
    mkdirSync(join(directory, 'config.json'));
    expectFileError(await fail('config'), /^No se pudo leer \.\.\.\/.+\/config\.json: es una carpeta\.$/);
  });

  it.runIf(withPermissions)('config.json sin permiso', async () => {
    chmodSync(saveConfig({}), 0o000);
    expectFileError(await fail('config'), /^No se pudo abrir \.\.\.\/.+\/config\.json: no tenés permiso\.$/);
  });

  it.runIf(withPermissions)('guardar con la carpeta de solo lectura', async () => {
    saveConfig({});
    chmodSync(directory, 0o500);

    try {
      expectFileError(
        await fail('config', 'establecer', 'puntoVenta', '4'),
        /^No se pudo escribir \.\.\.\/.+\/config\.json: no tenés permiso\.$/,
      );
    } finally {
      chmodSync(directory, 0o700);
    }
  });

  it.runIf(withPermissions)('certificado generar y completado sin permiso de escritura', async () => {
    const certificates = join(directory, 'certificados');

    saveConfig({ cuit: '20168598204' });
    mkdirSync(certificates, { mode: 0o500 });
    expectFileError(
      await fail('certificado', 'generar', '--reemplazar'),
      /^No se pudo crear la carpeta \.\.\.\/certificados\/20168598204: no tenés permiso\.$/,
    );

    vi.stubEnv('SHELL', '/bin/zsh');
    vi.stubEnv('ZDOTDIR', certificates);
    expectFileError(await fail('completado', 'instalar'), /^No se pudo abrir .*\.zshrc: no tenés permiso\.$/);
  });

  it('un error de red con el mismo código no se traduce', () => {
    const error = Object.assign(new Error('connect EACCES 10.0.0.1:443'), { code: 'EACCES', syscall: 'connect' });

    expect(JSON.parse(formatCliError(error, true))).toEqual({
      codigo: 'UNEXPECTED_ERROR',
      detalles: null,
      error: 'connect EACCES 10.0.0.1:443',
      sugerencia: null,
    });
  });

  it('en un lote, el mismo código, texto y sugerencia que solo', () => {
    const error = Object.assign(new Error("EACCES: permission denied, open '/Users/ana/x/y.key'"), {
      code: 'EACCES',
      path: '/Users/ana/x/y.key',
      syscall: 'open',
    });
    const alone = JSON.parse(formatCliError(error, true)) as JsonError;

    expect(alone.error).toBe('No se pudo abrir .../x/y.key: no tenés permiso.');
    expect(toBatchItemError(1, error)).toEqual({
      code: alone.codigo,
      index: 1,
      message: alone.error,
      suggestion: alone.sugerencia,
    });
  });

  it('el asistente muestra lo mismo', async () => {
    let shown = '';

    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      shown += String(chunk);

      return true;
    });
    await showAssistantError(
      Object.assign(new Error("EACCES: permission denied, open '/Users/ana/x/y.json'"), {
        code: 'EACCES',
        path: '/Users/ana/x/y.json',
        syscall: 'open',
      }),
    );

    expect(stripAnsi(shown)).toContain('No se pudo abrir .../x/y.json: no tenés permiso.');
    expect(shown).not.toContain('denied');
  });
});

describe('--cargar con un JSON ilegible (H11)', () => {
  it.each([
    ['una clave PEM', '-----BEGIN PRIVATE KEY-----\nMIIEsecreto', 'mal escrito en la línea 1, columna 2'],
    ['una coma de más', '{\n  "monto": 1,\n}', 'mal escrito en la línea 3, columna 1'],
    ['texto suelto', 'hola-secreto', 'mal escrito'],
    ['vacío', '', 'está vacío'],
    ['cortado', '{"monto": 1', 'se corta en la línea 1, columna 12: falta el final'],
    ['cortado en un texto', '{"monto": "secreto', 'se corta en la línea 1, columna 19: falta el final'],
  ])('%s, en A/B/C y en la E', async (_name, content, reason) => {
    const path = join(directory, 'datos.json');

    saveProfile();
    writeFileSync(path, content);

    for (const command of ['fc', 'fe']) {
      const { json, text } = await fail(command, '--cargar', path);
      const { cause, ...rest } = json.detalles as { cause: string };

      expect(json.codigo).toBe('INPUT_VALIDATION_ERROR');
      expect(rest).toEqual({ ruta: path });
      expect(cause).toContain(reason);
      expect(json.error).toMatch(/^No se pudo leer el archivo JSON \.\.\.\/[^/]+\/datos\.json: /);
      expect(json.error.endsWith(`: ${cause}.`)).toBe(true);
      expect(json.error).not.toContain(directory);
      expect(JSON.stringify({ ...json, text })).not.toMatch(/secreto|BEGIN|hola|Unexpected|token|position/);
      expect(text).not.toContain('Detalles');
      expect(text.split('datos.json')).toHaveLength(2);
    }
  });
});
