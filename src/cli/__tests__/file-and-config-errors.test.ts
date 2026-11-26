import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { resolveIvaConditionFromPadron } from '../../modules/billing/billing.padron';
import { billingCommandSchema } from '../../modules/billing/billing.schemas';
import { installCompletion } from '../../modules/completion/installer';
import { checkExportPermits } from '../../modules/export/export.permits';
import { stripAnsi } from '../../ui';
import { formatCliError, reportCliError, serializeCliError } from '../error-output';
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
    text: stripAnsi(formatCliError(thrown)).replace(/[│┃║╏\s]+/g, ' '),
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

    it('varias a la vez: las nombra y dice cómo arreglarlas de a una', async () => {
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
      expect(json.sugerencia).not.toContain(path);
      expect(json.sugerencia).toContain('arcli config establecer cuit');
      expect(json.sugerencia).toContain('arcli config eliminar entorno');
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
    expectFileError(await fail('config'), /^No se pudo leer \.\.\.\/dos\/config\.json: es una carpeta\.$/);
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

    expect(serializeCliError(error)).toEqual({
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
    const alone = serializeCliError(error) as JsonError;

    expect(alone.error).toBe('No se pudo abrir .../x/y.key: no tenés permiso.');
    expect(toBatchItemError(1, error)).toEqual({
      code: alone.codigo,
      index: 1,
      message: alone.error,
      suggestion: alone.sugerencia,
    });
  });

  describe('adentro de otro texto', () => {
    const ticketError = () =>
      Object.assign(new Error("EACCES: permission denied, open '/Users/ana/arcli/tickets/x.json'"), {
        code: 'EACCES',
        path: '/Users/ana/arcli/tickets/x.json',
        syscall: 'open',
      });
    const TEXT = 'No se pudo abrir .../arcli/tickets/x.json: no tenés permiso';

    it('en el aviso y en el error del padrón, con el punto recortado', async () => {
      const input = billingCommandSchema.parse({
        concept: 'servicios',
        documentNumber: 20201797064,
        documentType: 'cuit',
        ivaCondition: 'consumidor-final',
        ivaConditionSource: 'default',
        shortcut: 'fa',
        totalAmount: 1000,
      });
      const gateway = { getTaxpayer: () => Promise.reject(ticketError()) };

      expect((await resolveIvaConditionFromPadron(input, gateway)).warnings[0]).toContain(`(${TEXT}).`);
      await expect(
        resolveIvaConditionFromPadron({ ...input, ivaConditionSource: 'missing' }, gateway),
      ).rejects.toMatchObject({
        details: { codigoCausa: 'UNEXPECTED_ERROR' },
        message: expect.stringContaining(`(${TEXT})`),
      });
    });

    it('en los permisos de embarque de la E', async () => {
      const result = await checkExportPermits(
        { Permisos: { Permiso: [{ Dst_merc: 203, Id_permiso: 'P1' }] } } as never,
        { checkPermit: () => Promise.reject(ticketError()) },
      );

      expect(result?.warnings).toEqual([
        `No se pudo verificar el permiso de embarque P1 en ARCA (${TEXT}): revisalo antes de emitir.`,
      ]);
    });
  });

  it('el autocompletado nombra el archivo que es una carpeta', () => {
    mkdirSync(join(directory, '.zshrc'));

    expect(() => installCompletion('zsh', { home: directory, platform: 'linux' })).toThrow(
      expect.objectContaining({ code: 'EISDIR', path: join(directory, '.zshrc') }),
    );
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

/**
 * Caracterización antes de ARQ-12: la lectura de archivos sale del núcleo (services/files y puertos) y estos errores
 * tienen que quedar iguales, con su código, texto, detalles y sugerencia.
 */
describe('leer archivos del usuario: mismos errores (ARQ-12)', () => {
  const ENCRYPTED_KEY = '-----BEGIN ENCRYPTED PRIVATE KEY-----\nX\n-----END ENCRYPTED PRIVATE KEY-----';
  const PERMISSION_SUGGESTION =
    'Revisá que tu usuario tenga permiso ahí y que otro programa no lo esté usando, o elegí otra ruta.';

  /** Un archivo de la carpeta temporal; sin contenido, no se crea. */
  function userFile(name: string, content?: string): string {
    const path = join(directory, name);

    if (content !== undefined) {
      writeFileSync(path, content);
    }

    return path;
  }

  /** El config.json, si el comando lo llegó a crear. */
  function savedConfig(): string {
    const path = join(directory, 'config.json');

    return existsSync(path) ? readFileSync(path, 'utf8') : '';
  }

  it.each([
    ['cert.testing', 'no-esta.crt', undefined, 'La ruta del certificado no existe: .../dos/no-esta.crt'],
    ['key.produccion', 'no-esta.key', undefined, 'La ruta de la clave privada no existe: .../dos/no-esta.key'],
    [
      'cert.testing',
      'malo.pem',
      'NO-ES-PEM',
      'La ruta del certificado apunta a un archivo con formato PEM inválido: .../dos/malo.pem. Debe contener un bloque como -----BEGIN CERTIFICATE-----.',
    ],
    [
      'key.testing',
      'malo.pem',
      'NO-ES-PEM',
      'La ruta de la clave privada apunta a un archivo con formato PEM inválido: .../dos/malo.pem. Debe contener un bloque como -----BEGIN PRIVATE KEY-----.',
    ],
    [
      'key.testing',
      'cifrada.key',
      ENCRYPTED_KEY,
      'La clave privada está cifrada con contraseña y ARCLI no puede usarla: .../dos/cifrada.key. Generala sin contraseña o descifrala con `openssl pkey -in clave.key -out clave-sin-pass.key`.',
    ],
  ])('config establecer %s con %s', async (key, name, content, error) => {
    const { json } = await fail('config', 'establecer', key, userFile(name, content));

    expect(json).toEqual({
      codigo: 'CONFIGURATION_ERROR',
      detalles: { ruta: `.../dos/${name}` },
      error,
      sugerencia: null,
    });
    expect(savedConfig()).not.toContain(name);
  });

  it.runIf(withPermissions).each(['cert.testing', 'key.testing'])(
    'config establecer %s con un PEM sin permiso de lectura falla, no lo da por inexistente',
    async (key) => {
      const path = userFile('bloqueado.pem', '-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----');

      chmodSync(path, 0o000);

      expect((await fail('config', 'establecer', key, path)).json).toEqual({
        codigo: 'UNEXPECTED_ERROR',
        detalles: null,
        error: 'No se pudo abrir .../dos/bloqueado.pem: no tenés permiso.',
        sugerencia: PERMISSION_SUGGESTION,
      });
      expect(savedConfig()).not.toContain('bloqueado.pem');
    },
  );

  it.each([
    ['emisor.logo', 'no-esta.png', 'el logo'],
    ['pdfNavegador', 'no-esta-chrome', 'el navegador'],
  ])('config establecer %s con una ruta que no existe', async (key, name, label) => {
    const path = userFile(name);

    expect((await fail('config', 'establecer', key, path)).json).toEqual({
      codigo: 'INPUT_VALIDATION_ERROR',
      detalles: null,
      error: `No se encontró ${label} en "${path}".`,
      sugerencia:
        'Mirá cada clave con sus valores válidos en `arcli config establecer --ayuda`, y la config actual con `arcli config`.',
    });
    expect(savedConfig()).not.toContain(name);
  });

  it('--cargar con un JSON que no existe, en A/B/C y en la E', async () => {
    const path = userFile('no-esta.json');

    saveProfile();

    for (const command of ['fc', 'fe']) {
      expect((await fail(command, '--cargar', path)).json).toEqual({
        codigo: 'INPUT_VALIDATION_ERROR',
        detalles: { ruta: path },
        error: `La ruta del archivo JSON no existe: ${path}`,
        sugerencia: null,
      });
    }
  });

  it.runIf(withPermissions)('--cargar con un JSON sin permiso de lectura, en A/B/C y en la E', async () => {
    const path = userFile('bloqueado.json', '{}');

    saveProfile();
    chmodSync(path, 0o000);

    for (const command of ['fc', 'fe']) {
      expect((await fail(command, '--cargar', path)).json).toEqual({
        codigo: 'UNEXPECTED_ERROR',
        detalles: null,
        error: 'No se pudo abrir .../dos/bloqueado.json: no tenés permiso.',
        sugerencia: PERMISSION_SUGGESTION,
      });
    }
  });

  describe('config revisar con el certificado configurado', () => {
    async function expiryCheck(certPath: string): Promise<unknown> {
      let stdout = '';

      saveConfig({ cert: { testing: certPath }, cuit: '20123456786', key: { testing: certificate.keyPath } });
      vi.mocked(process.stdout.write).mockImplementation((chunk) => {
        stdout += String(chunk);

        return true;
      });
      await createProgram().parseAsync(['node', 'arcli', 'config', 'revisar', '--json']);

      const report = JSON.parse(stdout) as { chequeos: Array<{ etiqueta: string }> };

      return report.chequeos.find((check) => check.etiqueta === 'Vencimiento cert. testing');
    }

    const unverified = (reason: string) => ({
      categoria: 'warning',
      detalle: `No se pudo verificar el vencimiento del certificado de testing: ${reason}`,
      etiqueta: 'Vencimiento cert. testing',
    });

    it('legible: lee el vencimiento', async () => {
      expect(await expiryCheck(certificate.certPath)).toEqual({
        categoria: 'ok',
        detalle: expect.stringMatching(/^El certificado de testing vence el \d{1,2}\/\d{2}\/\d{4}\.$/),
        etiqueta: 'Vencimiento cert. testing',
      });
    });

    it.each([
      ['no existe', undefined, 'La ruta del certificado no existe: .../dos/cert.crt'],
      [
        'no es PEM',
        'NO-ES-PEM',
        'La ruta del certificado apunta a un archivo con formato PEM inválido: .../dos/cert.crt. Debe contener un bloque como -----BEGIN CERTIFICATE-----.',
      ],
    ])('%s: avisa con el error de lectura', async (_name, content, reason) => {
      expect(await expiryCheck(userFile('cert.crt', content))).toEqual(unverified(reason));
    });

    it.runIf(withPermissions)('sin permiso de lectura: avisa que no pudo abrirlo', async () => {
      const path = userFile('cert.crt', certificate.pem);

      chmodSync(path, 0o000);

      expect(await expiryCheck(path)).toEqual(unverified('No se pudo abrir .../dos/cert.crt: no tenés permiso.'));
    });
  });
});
