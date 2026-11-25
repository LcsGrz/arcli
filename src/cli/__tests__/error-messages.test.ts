import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError, ConfigurationError, InputValidationError } from '../../lib/errors/app-error';
import { stripAnsi } from '../../ui';
import { formatCliError, reportCliError, serializeCliError } from '../error-output';
import { createProgram } from '../program';

/** Los textos de ERR-12, por el comando real y con lo que se ve en la terminal o en `--json`. Sin red. */

const padron = { getTaxpayer: vi.fn(async () => null) };

vi.mock('../../services/arca/arca-padron.gateway', () => ({
  ArcaPadronGateway: class {
    public constructor() {
      return padron;
    }
  },
}));
vi.mock('../../services/arca/arca-client.factory', () => ({
  ArcaClientFactory: class {
    public create(): object {
      return {};
    }

    public createExportGateway(): object {
      return new Proxy({}, { get: () => async () => [] });
    }
  },
}));
// Lo que sigue a leer la config real, sin certificados: el perfil listo para usar.
vi.mock('../arca-runtime', async (original) => {
  const { arcliConfigSchema } = await import('../../modules/config/config.schemas');

  return {
    ...(await original<typeof import('../arca-runtime')>()),
    resolveArcaRuntime: () => ({
      certificateNotices: [],
      config: arcliConfigSchema.parse({ cuit: '20111111112', exportacion: { actividad: 620100 }, pdf: 'nunca' }),
      context: { cuit: 20111111112 },
      cuit: 20111111112,
      environment: 'testing',
      outputJson: true,
      outputRaw: false,
    }),
  };
});

let directory = '';

function plain(text: string): string {
  return stripAnsi(text).replace(/[│┃║╏\s]+/g, ' ');
}

interface JsonError {
  readonly codigo: string;
  readonly detalles: unknown;
  readonly error: string;
  readonly sugerencia: string | null;
}

async function failingJson(...args: string[]): Promise<JsonError> {
  let stderr = '';
  const write = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);

    return true;
  });

  try {
    await createProgram().parseAsync(['node', 'arcli', ...args]);
  } catch (error) {
    expect(reportCliError(error, true)).toBe(1);
  } finally {
    write.mockRestore();
  }

  return JSON.parse(stderr) as JsonError;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'arcli-textos-'));
  vi.stubEnv('ARCLI_CONFIG_DIR', directory);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  rmSync(directory, { force: true, recursive: true });
});

describe('la sugerencia del panel', () => {
  it.each([
    [new InputValidationError('Sacá `--acuit` o usá ese CUIT.'), 'arcli ayuda'],
    [new ConfigurationError('Falta el CUIT.'), 'arcli config revisar'],
  ])('entrada y config suman la de siempre', (error, hint) => {
    expect(plain(formatCliError(error))).toContain(hint);
    expect(serializeCliError(error)).toMatchObject({ sugerencia: null });
  });

  it.each([
    ['cert', {}, 'Falta la ruta del certificado para producción.'],
    ['key', { cert: { produccion: 'x.crt' } }, 'Falta la ruta de la clave privada para producción.'],
  ])('la ruta que falta trae el comando para configurarla: %s', async (key, config, message) => {
    const { credentialPaths } = await import('../../modules/config/arca-profile');
    const { arcliConfigSchema } = await import('../../modules/config/config.schemas');

    expect(() => credentialPaths(arcliConfigSchema.parse(config), 'produccion')).toThrow(
      `${message} Configurala con \`arcli config establecer ${key}.produccion <ruta>\`.`,
    );
  });

  it.each([
    'getaddrinfo ENOTFOUND wsaahomo.afip.gov.ar',
    'connect ETIMEDOUT 10.0.0.1:443',
    'connect ECONNREFUSED 10.0.0.1:443',
    'socket hang up',
  ])('un error de red (%s) manda a revisar la conexión', (message) => {
    const text = plain(formatCliError(new Error(message)));

    expect(text).toContain('Revisá tu conexión a internet');
    expect(text).not.toContain('más contexto');
    expect(serializeCliError(new Error(message))).toEqual({
      codigo: 'UNEXPECTED_ERROR',
      detalles: null,
      error: message,
      sugerencia: null,
    });
  });

  it('cualquier otro error inesperado no pide "más contexto"', () => {
    const text = plain(formatCliError(new Error('cms.cert.untrusted')));

    expect(text).toContain('arcli config revisar');
    expect(text).not.toContain('más contexto');
    expect(text).not.toContain('conexión');
  });
});

describe('los detalles del panel no repiten el mensaje (H21)', () => {
  it('ni la causa ni la ruta que ya están en el mensaje', () => {
    const error = new InputValidationError('No se pudo leer el archivo JSON "/tmp/x.json": JSON inválido', {
      cause: 'JSON inválido',
      path: '/tmp/x.json',
    });

    expect(plain(formatCliError(error))).not.toContain('Detalles');
    expect(serializeCliError(error)).toMatchObject({
      detalles: { cause: 'JSON inválido', ruta: '/tmp/x.json' },
    });
  });

  it('ni el entorno, que el mensaje dice con tilde', () => {
    const error = new AppError('El certificado de producción venció el 20/11/2026: ARCA no lo acepta.', {
      code: 'CERTIFICATE_EXPIRED',
      details: { entorno: 'produccion', vencimiento: '20/11/2026' },
      suggestion: 'Renovalo.',
    });

    expect(plain(formatCliError(error))).not.toContain('Detalles');
  });

  it('lo que suma se ve con un nombre que se lee, y un número adentro de otro no cuenta como dicho', () => {
    const error = new AppError('No se pudo confirmar la emisión: timeout a los 17 s', {
      code: 'EMISSION_UNCERTAIN',
      details: { causa: 'timeout a los 17 s', idSolicitud: 42, numero: 7 },
    });
    const text = plain(formatCliError(error));

    expect(text).toContain('Solicitud: 42');
    expect(text).toContain('Número: 7');
    expect(text).not.toContain('Causa');
    expect(text).not.toContain('idSolicitud');
  });
});

describe('una regla, un texto (H16 y H17)', () => {
  const MISSING_POINT_OF_SALE =
    'Falta el punto de venta. Usá `--pv <numero>` o configuralo con `arcli config establecer puntoVenta <numero>`.';
  const INVALID_POINT_OF_SALE = 'El punto de venta tiene que ser un número entero positivo.';

  it.each([
    [['consultar', 'fc', '1']],
    [['ultimos', 'fc']],
    [['ultimos', 'fe']],
    [['fc', '-m', '1000', '--cs', '--cfinal', '--previsualizar']],
    [['ncc', '-m', '1000', '--cs', '--cfinal', '--periodo-desde', 'mes-pasado', '--periodo-hasta', 'hoy']],
  ])('sin punto de venta: %j', async (args) => {
    expect(await failingJson(...args)).toEqual({
      codigo: 'INPUT_VALIDATION_ERROR',
      detalles: null,
      error: MISSING_POINT_OF_SALE,
      sugerencia: null,
    });
  });

  it.each([[['consultar', 'fc', '1']], [['consultar', 'fe', '1']], [['ultimos', 'fc']], [['ultimos', 'fe']]])(
    'un punto de venta en cero es inválido, no falta: %j --pv 0',
    async (args) => {
      expect(await failingJson(...args, '--pv', '0')).toEqual({
        codigo: 'INPUT_VALIDATION_ERROR',
        detalles: null,
        error: INVALID_POINT_OF_SALE,
        sugerencia: null,
      });
    },
  );

  it('la E, sin punto de venta y con uno inválido, dice lo mismo', async () => {
    const { resolveExportPointOfSale } = await import('../../modules/export/export.numbering');

    expect(() => resolveExportPointOfSale(undefined, {})).toThrow(MISSING_POINT_OF_SALE);
    expect(() => resolveExportPointOfSale(0, {})).toThrow(INVALID_POINT_OF_SALE);
  });

  it('el IVA receptor que falta: el mismo qué hacer sin padrón y si el padrón no lo da', async () => {
    const hint =
      'Usá `--ir <tipo>` o un flag `--ir-*`, o configurá uno por defecto con `arcli config establecer ivaReceptor <tipo>`.';
    const base = ['-m', '1000', '--cs', '--pv', '3', '--previsualizar'];

    expect(await failingJson('fb', ...base, '--dni', '12345678')).toMatchObject({
      codigo: 'INPUT_VALIDATION_ERROR',
      error: `Falta IVA receptor. ${hint}`,
      sugerencia: null,
    });
    expect(await failingJson('fb', ...base, '--cuit', '20201797064')).toMatchObject({
      codigo: 'INPUT_VALIDATION_ERROR',
      error: `Falta IVA receptor. El CUIT 20201797064 no figura en el padrón de ARCA. ${hint}`,
      sugerencia: null,
    });
  });
});

describe('`--pv 0` al facturar', () => {
  it.each(['fc', 'ncc', 'fcea', 'rc'])(
    '%s: el mismo texto que en las consultas, con la forma de siempre',
    async (shortcut) => {
      expect(await failingJson(shortcut, '-m', '1000', '--cs', '--cfinal', '--pv', '0', '--previsualizar')).toEqual({
        codigo: 'INPUT_VALIDATION_ERROR',
        detalles: [{ mensaje: 'El punto de venta tiene que ser un número entero positivo.', ruta: ['puntoVenta'] }],
        error: 'Hay parámetros inválidos o incompletos en la entrada.',
        sugerencia: null,
      });
    },
  );
});

describe('formato (H19)', () => {
  it('los importes del error van como en el resto de la salida', async () => {
    const { error } = await failingJson(
      ...['fb', '-m', '2000,50', '--cs', '--cfinal', '--pv', '3', '--previsualizar'],
      ...['--alicuota', 'general:1210', '--alicuota', 'reducida:552,50'],
    );

    expect(error).toContain(
      'La suma de las alícuotas (1.762,50) no coincide con lo gravado del monto total (2.000,50).',
    );
  });
});

describe('al asociado le falta un dato (H20)', () => {
  const NOTE = ['-m', '1000', '--cs', '--pv', '3', '--previsualizar'];

  const PERIOD = ', o un período con `--periodo-desde` y `--periodo-hasta` en vez del comprobante.';

  it.each<[string, string[], string]>([
    [
      'el punto de venta, de otro CUIT',
      ['--ac', 'fb', '--ar', '1', '--acuit', '30709965812'],
      'Falta el punto de venta',
    ],
    ['el número', ['--ac', 'fb', '--apv', '3'], 'Falta el número'],
    ['el tipo', ['--apv', '3', '--ar', '1'], 'Falta el tipo'],
    ['el número, sin `--apv`', ['--ac', 'fb'], 'Falta el número'],
    ['dos datos', ['--apv', '3'], 'Faltan el tipo y el número'],
  ])('%s', async (name, associated, expected) => {
    const use = {
      'dos datos': '`--ac <tipo>` y `--ar <número>`',
      'el número, sin `--apv`': '`--ar <número>` (y `--apv` si es de otro punto de venta)',
      'el número': '`--ar <número>`',
      'el punto de venta, de otro CUIT': '`--apv <número>`',
      'el tipo': '`--ac <tipo>`',
    }[name];
    const json = await failingJson('ncb', ...NOTE, '--cfinal', ...associated);

    expect(json).toMatchObject({ codigo: 'INPUT_VALIDATION_ERROR', detalles: null, sugerencia: null });
    expect(json.error).toBe(`${expected} del comprobante asociado de la nota de crédito B. Usá ${use}${PERIOD}`);
  });

  it('una nota FCE no ofrece el período: ARCA no lo acepta', async () => {
    const json = await failingJson(
      ...['ncea', '-m', '1000', '--cs', '--pv', '3', '--previsualizar'],
      ...['--cuit', '20123456786', '--ir', 'responsable-inscripto', '--ac', 'fcea', '--apv', '3'],
    );

    expect(json.error).toContain('Usá `--ar <número>`.');
    expect(json.error).not.toContain('período');
  });

  it('sin nada, pide el comprobante asociado como siempre', async () => {
    expect((await failingJson('ncb', ...NOTE, '--cfinal')).error).toContain(
      'La nota de crédito B requiere comprobante asociado. Usá `--ac` o `--at`',
    );
  });
});
