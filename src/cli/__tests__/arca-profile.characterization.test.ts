import { Command } from 'commander';
import { X509Certificate } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSelfSignedCertificate,
  OPENSSL_WARM_UP_TIMEOUT_MS,
  removeSelfSignedCertificates,
  type SelfSignedCertificate,
} from '../../lib/security/__tests__/self-signed-certificate';
import { CertificateExpiredError } from '../../modules/config/certificate-expiry';
import { MISSING_CUIT_MESSAGE } from '../../modules/config/config.schemas';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { stripAnsi } from '../../ui';
import { resolveArcaRuntime } from '../arca-runtime';
import {
  type BillingCommandGateways,
  executeBillingCommand,
  registerBillingCommandOptions,
} from '../commands/billing.command.shared';
import { reportCliError } from '../error-output';
import { createProgram } from '../program';

/**
 * Caracterizacion del perfil de ARCA (REV-48): config, entorno, CUIT, certificados, salida y permisos, tal como los
 * ve quien usa el CLI hoy. Entran por `resolveArcaRuntime`, los comandos con `--json` y `ArcaClientFactory`, no por
 * la clase que los resuelve por dentro: el refactor la reemplaza y estos tests tienen que pasar sin cambios.
 */

// Ningun test llega a ARCA: el cliente del SDK es un doble que solo registra con que contexto se creo.
const Arca = vi.hoisted(() => vi.fn());

vi.mock('@arcasdk/core', async (original) => ({
  ...(await original<typeof import('@arcasdk/core')>()),
  Arca,
}));

vi.mock('../spinner', () => ({ startSpinner: () => null, withSpinner: (_text: unknown, run: () => unknown) => run() }));

const CUIT = '20123456786';
const DAY = 24 * 60 * 60 * 1000;
const originalConfigDirectory = process.env.ARCLI_CONFIG_DIR;
const temporaryDirectories: string[] = [];

/** Carpeta de config propia de cada test: `new ConfigService()` la lee de `ARCLI_CONFIG_DIR` en cada resolucion. */
let configDirectory = '';
let stdout = '';
let stderr = '';
/** Vence en ~10 dias: da el aviso "por vencer" con el reloj real. */
let expiring: SelfSignedCertificate;
/** Vence en ~1 año: sin aviso. */
let healthy: SelfSignedCertificate;
/** Otro certificado sano, para distinguir el de exportacion del de facturacion. */
let exportOnly: SelfSignedCertificate;

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));

  temporaryDirectories.push(directory);

  return directory;
}

/** Escribe el config.json tal cual, como si lo hubiera dejado una version anterior o una edicion a mano. */
function writeConfig(content: Record<string, unknown>): void {
  writeFileSync(join(configDirectory, 'config.json'), JSON.stringify(content, null, 2), 'utf8');
}

/** Config completa para un entorno, con el certificado indicado; `extra` pisa lo que haga falta. */
function configWith(certificate: SelfSignedCertificate, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cert: { produccion: certificate.certPath, testing: certificate.certPath },
    cuit: CUIT,
    key: { produccion: certificate.keyPath, testing: certificate.keyPath },
    ...extra,
  };
}

/** Mueve el reloj a `days` dias despues del vencimiento del certificado (negativo: antes). */
function moveClockAfterExpiry(certificate: SelfSignedCertificate, days: number): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(new X509Certificate(certificate.pem).validTo).getTime() + days * DAY);
}

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

/** Corre el CLI con `--json` e imprime el error como `index.ts`: devuelve stdout, stderr y el JSON de error. */
async function runJsonError(argv: string[]): Promise<Record<string, unknown>> {
  let thrown: unknown;

  try {
    await createProgram().parseAsync(['node', 'arcli', ...argv, '--json']);
  } catch (error) {
    thrown = error;
  }

  if (thrown === undefined) {
    throw new Error(`se esperaba un error con ${argv.join(' ')}`);
  }

  reportCliError(thrown, true);

  return JSON.parse(stderr) as Record<string, unknown>;
}

function billingGateways(): BillingCommandGateways {
  return {
    billing: {
      createVoucher: vi.fn(),
      getNextVoucherNumber: vi.fn(async () => 42),
      getQuotation: vi.fn(async () => 1000),
    },
    fce: { getObligation: vi.fn() } as never,
    fceRegistry: { getVoucherState: vi.fn(async () => undefined) },
    history: { getLastNumber: vi.fn(async () => 0), getVoucher: vi.fn(async () => undefined) },
    padron: { getTaxpayer: vi.fn(async () => null) },
  };
}

/** Vista previa de una factura C con el runtime real y ARCA falso: lo que sale en stdout. */
async function previewInvoice(...flags: string[]): Promise<string> {
  const command = new Command('fc');

  registerBillingCommandOptions(command);
  command.parse(['node', 'fc', '-m', '1000', '--cs', '--cfinal', '--pv', '3', '--previsualizar', ...flags]);
  await executeBillingCommand(
    command,
    'fc',
    {},
    { createGateways: billingGateways, resolveRuntime: resolveArcaRuntime },
  );

  return stdout;
}

beforeAll(() => {
  expiring = createSelfSignedCertificate(10);
  healthy = createSelfSignedCertificate(365);
  exportOnly = createSelfSignedCertificate(366);
}, OPENSSL_WARM_UP_TIMEOUT_MS);

afterAll(removeSelfSignedCertificates);

beforeEach(() => {
  configDirectory = temporaryDirectory('arcli-perfil-');
  process.env.ARCLI_CONFIG_DIR = configDirectory;
  stdout = '';
  stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  Arca.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.env.ARCLI_CONFIG_DIR = originalConfigDirectory;
  process.exitCode = undefined;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('entorno: flags y config', () => {
  it.each([
    [{}, 'testing', 'testing'],
    [{}, 'produccion', 'produccion'],
    [{ testing: true }, 'produccion', 'testing'],
    [{ testing: true }, 'testing', 'testing'],
    [{ produccion: true }, 'testing', 'produccion'],
    [{ produccion: true }, 'produccion', 'produccion'],
  ] as const)('flags %j con entorno %s en la config: %s', (flags, configured, expected) => {
    writeConfig({
      cert: { produccion: exportOnly.certPath, testing: healthy.certPath },
      cuit: CUIT,
      entornoPorDefecto: configured,
      key: { produccion: exportOnly.keyPath, testing: healthy.keyPath },
    });

    const runtime = resolveArcaRuntime(flags);

    expect(runtime.environment).toBe(expected);
    expect(runtime.context.production).toBe(expected === 'produccion');
    // Los PEM son los del entorno elegido, no los del otro.
    expect(runtime.context.cert).toBe((expected === 'produccion' ? exportOnly : healthy).pem);
  });

  it('sin entorno en la config usa testing', () => {
    writeConfig({ cert: { testing: healthy.certPath }, cuit: CUIT, key: { testing: healthy.keyPath } });

    expect(resolveArcaRuntime({}).environment).toBe('testing');
  });

  it.each(['testing', 'produccion'] as const)(
    '--testing y --produccion juntos es un error de configuracion, con entorno %s en la config',
    (configured) => {
      writeConfig(configWith(healthy, { entornoPorDefecto: configured }));

      expect(() => resolveArcaRuntime({ produccion: true, testing: true })).toThrow(
        expect.objectContaining({
          code: 'CONFIGURATION_ERROR',
          message: 'Usá `--testing` o `--produccion`, pero no ambos a la vez.',
        }),
      );
    },
  );

  it('--testing y --produccion juntos da error aunque falte el CUIT: el entorno se mira primero', () => {
    writeConfig({});

    expect(() => resolveArcaRuntime({ produccion: true, testing: true })).toThrow(
      'Usá `--testing` o `--produccion`, pero no ambos a la vez.',
    );
  });
});

describe('CUIT', () => {
  it('sin CUIT: error de configuracion con el mensaje de siempre', () => {
    writeConfig({ cert: { testing: healthy.certPath }, key: { testing: healthy.keyPath } });

    expect(() => resolveArcaRuntime({})).toThrow(
      expect.objectContaining({ code: 'CONFIGURATION_ERROR', message: MISSING_CUIT_MESSAGE }),
    );
  });

  it('con CUIT valido lo pasa como numero al contexto de ARCA', () => {
    writeConfig(configWith(healthy));

    expect(resolveArcaRuntime({}).context.cuit).toBe(20123456786);
  });

  it('sin CUIT con --json: CONFIGURATION_ERROR en stderr, stdout vacio', async () => {
    writeConfig({ cert: { testing: healthy.certPath }, key: { testing: healthy.keyPath } });

    expect(await runJsonError(['estado'])).toMatchObject({
      codigo: 'CONFIGURATION_ERROR',
      error: MISSING_CUIT_MESSAGE,
    });
    expect(stdout).toBe('');
  });

  it.each([
    ['con largo invalido', '2012345678'],
    ['no numerico', '2012345678X'],
  ])('%s en la config: lo frena el esquema de la config, con --json', async (_case, cuit) => {
    writeConfig(configWith(healthy, { cuit }));

    expect(await runJsonError(['estado'])).toEqual({
      codigo: 'INPUT_VALIDATION_ERROR',
      detalles: [{ mensaje: 'El CUIT debe tener 11 dígitos', ruta: ['cuit'] }],
      error: 'Hay parámetros inválidos o incompletos en la entrada.',
      sugerencia: null,
    });
    expect(stdout).toBe('');
  });
});

describe('rutas del certificado y la clave', () => {
  it.each(['testing', 'produccion'] as const)('falta la ruta del certificado de %s', (environment) => {
    writeConfig({ cuit: CUIT, entornoPorDefecto: environment, key: { [environment]: healthy.keyPath } });

    expect(() => resolveArcaRuntime({})).toThrow(
      expect.objectContaining({
        code: 'CONFIGURATION_ERROR',
        message: `Falta la ruta del certificado para ${environment}. Configurá "cert.${environment}".`,
      }),
    );
  });

  it('falta la ruta de la clave', () => {
    writeConfig({ cert: { testing: healthy.certPath }, cuit: CUIT });

    expect(() => resolveArcaRuntime({})).toThrow(
      expect.objectContaining({
        code: 'CONFIGURATION_ERROR',
        message: 'Falta la ruta de la clave privada para testing. Configurá "key.testing".',
      }),
    );
  });

  it('sin ninguna de las dos, se nombra primero el certificado', () => {
    writeConfig({ cuit: CUIT });

    expect(() => resolveArcaRuntime({})).toThrow('Falta la ruta del certificado para testing.');
  });

  it('la ruta del certificado no existe: error con la ruta enmascarada', () => {
    const missing = join(configDirectory, 'no-existe', 'cert.pem');

    writeConfig({ cert: { testing: missing }, cuit: CUIT, key: { testing: healthy.keyPath } });

    expect(() => resolveArcaRuntime({})).toThrow(
      expect.objectContaining({
        code: 'CONFIGURATION_ERROR',
        message: expect.stringMatching(/^La ruta del certificado no existe: \.{3}[\\/].*cert\.pem$/),
      }),
    );
  });

  it('la ruta de la clave no existe: error con la ruta enmascarada', () => {
    const missing = join(configDirectory, 'no-existe', 'key.pem');

    writeConfig({ cert: { testing: healthy.certPath }, cuit: CUIT, key: { testing: missing } });

    expect(() => resolveArcaRuntime({})).toThrow(
      expect.objectContaining({
        code: 'CONFIGURATION_ERROR',
        message: expect.stringMatching(/^La ruta de la clave privada no existe: \.{3}[\\/].*key\.pem$/),
      }),
    );
  });

  it('el certificado no existe, con --json: CONFIGURATION_ERROR con la ruta enmascarada', async () => {
    writeConfig({
      cert: { testing: join(configDirectory, 'cert.pem') },
      cuit: CUIT,
      key: { testing: healthy.keyPath },
    });

    const error = await runJsonError(['estado']);

    expect(error).toMatchObject({
      codigo: 'CONFIGURATION_ERROR',
      error: expect.stringMatching(/^La ruta del certificado no existe: /),
    });
    expect(JSON.stringify(error)).not.toContain(configDirectory);
  });

  it('el certificado no es PEM: error de formato', () => {
    const notPem = join(configDirectory, 'cert.pem');

    writeFileSync(notPem, 'no es un certificado', 'utf8');
    writeConfig({ cert: { testing: notPem }, cuit: CUIT, key: { testing: healthy.keyPath } });

    expect(() => resolveArcaRuntime({})).toThrow(/formato PEM inválido/);
  });

  it('arma el contexto con los PEM leidos y el punto de venta de la config', () => {
    writeConfig(configWith(healthy, { puntoVentaPorDefecto: 7 }));

    const runtime = resolveArcaRuntime({});

    expect(runtime.pointOfSale).toBe(7);
    expect(runtime.context).toMatchObject({ cert: healthy.pem, cuit: 20123456786, production: false });
    expect(runtime.context.key).toContain('PRIVATE KEY');
    expect(runtime.config.cuit).toBe(CUIT);
  });

  it('sin punto de venta en la config queda sin definir', () => {
    writeConfig(configWith(healthy));

    expect(resolveArcaRuntime({}).pointOfSale).toBeUndefined();
  });
});

describe('tickets de ARCA', () => {
  it('por defecto, en la carpeta tickets junto a la config', () => {
    writeConfig(configWith(healthy));

    expect(resolveArcaRuntime({}).context.ticketPath).toBe(join(configDirectory, 'tickets'));
  });

  it('con ticketPath en la config, ese', () => {
    const custom = join(configDirectory, 'mis-tickets');

    writeConfig(configWith(healthy, { ticketPath: custom }));

    expect(resolveArcaRuntime({}).context.ticketPath).toBe(custom);
  });
});

describe('salida: --json y --bruto frente a la config', () => {
  it.each([
    [undefined, false, false],
    [undefined, true, true],
    [true, false, true],
    [false, true, false],
    [true, true, true],
    [false, false, false],
  ])('json flag %s, config %s: %s', (flag, configured, expected) => {
    writeConfig(configWith(healthy, { output: { jsonPorDefecto: configured } }));

    expect(resolveArcaRuntime(flag === undefined ? {} : { json: flag }).outputJson).toBe(expected);
  });

  it.each([
    [undefined, false, false],
    [undefined, true, true],
    [true, false, true],
    [false, true, false],
  ])('bruto flag %s, config %s: %s', (flag, configured, expected) => {
    writeConfig(configWith(healthy, { output: { brutoPorDefecto: configured } }));

    expect(resolveArcaRuntime(flag === undefined ? {} : { bruto: flag }).outputRaw).toBe(expected);
  });

  it('json y bruto son independientes', () => {
    writeConfig(configWith(healthy, { output: { brutoPorDefecto: true, jsonPorDefecto: false } }));

    expect(resolveArcaRuntime({ json: true })).toMatchObject({ outputJson: true, outputRaw: true });
  });
});

describe.skipIf(process.platform === 'win32')('permisos de las carpetas', () => {
  it('deja en 0700 la carpeta de la config y la de los tickets en cada resolucion', () => {
    const tickets = join(configDirectory, 'tickets');

    writeConfig(configWith(healthy));
    mkdirSync(tickets);
    chmodSync(configDirectory, 0o755);
    chmodSync(tickets, 0o755);

    resolveArcaRuntime({});

    expect(mode(configDirectory)).toBe(0o700);
    expect(mode(tickets)).toBe(0o700);

    chmodSync(configDirectory, 0o755);
    chmodSync(tickets, 0o755);
    resolveArcaRuntime({});

    expect(mode(configDirectory)).toBe(0o700);
    expect(mode(tickets)).toBe(0o700);
  });

  it('restringe la carpeta de tickets configurada, no la de por defecto', () => {
    const custom = join(temporaryDirectory('arcli-tickets-'), 'tickets');
    const defaultTickets = join(configDirectory, 'tickets');

    mkdirSync(custom);
    mkdirSync(defaultTickets);
    chmodSync(custom, 0o755);
    chmodSync(defaultTickets, 0o755);
    writeConfig(configWith(healthy, { ticketPath: custom }));

    resolveArcaRuntime({});

    expect(mode(custom)).toBe(0o700);
    expect(mode(defaultTickets)).toBe(0o755);
  });

  it('restringe antes de leer los certificados: tambien si el certificado no existe', () => {
    const tickets = join(configDirectory, 'tickets');

    writeConfig({
      cert: { testing: join(configDirectory, 'cert.pem') },
      cuit: CUIT,
      key: { testing: healthy.keyPath },
    });
    mkdirSync(tickets);
    chmodSync(configDirectory, 0o755);
    chmodSync(tickets, 0o755);

    expect(() => resolveArcaRuntime({})).toThrow(/no existe/);
    expect(mode(configDirectory)).toBe(0o700);
    expect(mode(tickets)).toBe(0o700);
  });

  it('no crea la carpeta de tickets si no existe', () => {
    writeConfig(configWith(healthy));

    resolveArcaRuntime({});

    expect(() => statSync(join(configDirectory, 'tickets'))).toThrow();
  });
});

describe('vencimiento del certificado', () => {
  it('sano: sin aviso en stderr ni en el runtime', () => {
    writeConfig(configWith(healthy));

    const runtime = resolveArcaRuntime({});

    expect(runtime.certificateExpiry).toBeUndefined();
    expect(runtime.certificateNotices).toEqual([]);
    expect(stdout + stderr).toBe('');
  });

  it('por vencer, sin --json: aviso en stderr y stdout limpio', () => {
    writeConfig(configWith(expiring));

    const runtime = resolveArcaRuntime({});

    expect(runtime.certificateExpiry).toMatchObject({ environment: 'testing', expired: false });
    expect(stdout).toBe('');
    expect(stripAnsi(stderr)).toMatch(/El certificado de testing vence el \d{2}\/\d{2}\/\d{4} \(en (9|10) días\)\./);
  });

  it('por vencer, con --json: el aviso sigue en stderr y stdout limpio', () => {
    writeConfig(configWith(expiring));

    resolveArcaRuntime({ json: true });

    expect(stdout).toBe('');
    expect(stripAnsi(stderr)).toContain('El certificado de testing vence el');
  });

  it('vencido, sin --json: aviso de vencido en stderr, sin cortar la resolucion', () => {
    writeConfig(configWith(expiring));
    moveClockAfterExpiry(expiring, 5);

    const runtime = resolveArcaRuntime({});

    expect(runtime.certificateExpiry).toMatchObject({ environment: 'testing', expired: true });
    expect(stripAnsi(stderr)).toMatch(/El certificado de testing venció el \d{2}\/\d{2}\/\d{4}\./);
  });

  it('vencido, con --json: nada en stderr al resolver (lo dice el error JSON)', () => {
    writeConfig(configWith(expiring));
    moveClockAfterExpiry(expiring, 5);

    resolveArcaRuntime({ json: true });

    expect(stdout + stderr).toBe('');
  });

  it('vencido, con --json en un comando: un solo JSON de error CERTIFICATE_EXPIRED, sin llegar a ARCA', async () => {
    writeConfig(configWith(expiring));
    moveClockAfterExpiry(expiring, 5);

    expect(await runJsonError(['estado'])).toMatchObject({
      codigo: 'CERTIFICATE_EXPIRED',
      error: expect.stringContaining('venció'),
    });
    expect(stdout).toBe('');
    expect(Arca).not.toHaveBeenCalled();
  });

  it('avisa el de produccion por vencer trabajando en testing, sin aviso del entorno activo', () => {
    writeConfig({
      cert: { produccion: expiring.certPath, testing: healthy.certPath },
      cuit: CUIT,
      key: { testing: healthy.keyPath },
    });

    const runtime = resolveArcaRuntime({});

    expect(runtime.certificateExpiry).toBeUndefined();
    expect(runtime.certificateNotices).toEqual([
      expect.objectContaining({ environment: 'produccion', expired: false }),
    ]);
    expect(stripAnsi(stderr)).toContain('El certificado de producción vence el');
  });

  it('con --json, la vista previa suma el aviso a "avisos"', async () => {
    writeConfig(configWith(expiring));

    const output = JSON.parse(await previewInvoice('--json')) as { avisos?: string[] };

    expect(output.avisos).toEqual(
      expect.arrayContaining([expect.stringMatching(/^El certificado de testing vence el .* Renovalo: /)]),
    );
    expect(stripAnsi(stderr)).toContain('El certificado de testing vence el');
  });

  it('sin --json, el aviso no se repite en la salida del comando', async () => {
    writeConfig(configWith(expiring));

    const output = stripAnsi(await previewInvoice());

    expect(output).toContain('FACTURA C');
    expect(output).not.toContain('El certificado de testing vence el');
    expect(stripAnsi(stderr)).toContain('El certificado de testing vence el');
  });
});

describe('factura E: certificado de exportacion', () => {
  it('sin certificado dedicado, WSFEX usa el mismo contexto que facturacion', () => {
    writeConfig(configWith(healthy));

    const runtime = resolveArcaRuntime({});

    new ArcaClientFactory().createForExport(runtime);

    expect(Arca).toHaveBeenCalledWith(runtime.context);
  });

  it('con certificado dedicado, WSFEX usa sus PEM y el resto del contexto de facturacion', () => {
    writeConfig(
      configWith(healthy, {
        exportacion: { cert: { testing: exportOnly.certPath }, key: { testing: exportOnly.keyPath } },
      }),
    );

    const runtime = resolveArcaRuntime({});

    new ArcaClientFactory().createForExport(runtime);

    expect(runtime.context.cert).toBe(healthy.pem);
    expect(Arca).toHaveBeenCalledWith({
      ...runtime.context,
      cert: exportOnly.pem,
      key: expect.stringContaining('PRIVATE KEY'),
    });
    expect(Arca.mock.calls[0]?.[0]).toMatchObject({
      cuit: 20123456786,
      production: false,
      ticketPath: join(configDirectory, 'tickets'),
    });
  });

  it('el gateway de WSFEX tambien usa el certificado dedicado', () => {
    writeConfig(
      configWith(healthy, {
        exportacion: { cert: { testing: exportOnly.certPath }, key: { testing: exportOnly.keyPath } },
      }),
    );

    new ArcaClientFactory().createExportGateway(resolveArcaRuntime({}));

    expect(Arca).toHaveBeenCalledWith(expect.objectContaining({ cert: exportOnly.pem }));
  });

  it('sin dedicado y con el certificado de facturacion vencido: corta antes de crear el cliente', () => {
    writeConfig(configWith(expiring));
    moveClockAfterExpiry(expiring, 5);

    const runtime = resolveArcaRuntime({});

    expect(() => new ArcaClientFactory().createForExport(runtime)).toThrow(CertificateExpiredError);
    expect(Arca).not.toHaveBeenCalled();
  });

  it('con dedicado vencido: corta aunque el de facturacion este sano', () => {
    writeConfig(
      configWith(healthy, {
        exportacion: { cert: { testing: expiring.certPath }, key: { testing: expiring.keyPath } },
      }),
    );
    moveClockAfterExpiry(expiring, 5);

    const runtime = resolveArcaRuntime({});

    expect(runtime.certificateExpiry).toBeUndefined();
    expect(() => new ArcaClientFactory().createForExport(runtime)).toThrow(CertificateExpiredError);
    expect(Arca).not.toHaveBeenCalled();
  });

  it('con dedicado sano: sigue aunque el de facturacion este vencido', () => {
    writeConfig(
      configWith(expiring, {
        exportacion: { cert: { testing: exportOnly.certPath }, key: { testing: exportOnly.keyPath } },
      }),
    );
    moveClockAfterExpiry(expiring, 5);

    new ArcaClientFactory().createForExport(resolveArcaRuntime({}));

    expect(Arca).toHaveBeenCalledWith(expect.objectContaining({ cert: exportOnly.pem }));
  });

  it('dedicado a medias (solo el certificado): error de configuracion que nombra la clave que falta', () => {
    writeConfig(configWith(healthy, { exportacion: { cert: { testing: exportOnly.certPath } } }));

    expect(() => new ArcaClientFactory().createForExport(resolveArcaRuntime({}))).toThrow(
      expect.objectContaining({
        code: 'CONFIGURATION_ERROR',
        details: { faltan: ['exportacion.key.testing'] },
        message: 'Para WSFEX en testing configurá el certificado y la clave juntos.',
      }),
    );
  });

  it('el dedicado es por entorno: el de produccion no se usa en testing', () => {
    writeConfig(
      configWith(healthy, {
        exportacion: { cert: { produccion: exportOnly.certPath }, key: { produccion: exportOnly.keyPath } },
      }),
    );

    new ArcaClientFactory().createForExport(resolveArcaRuntime({}));

    expect(Arca).toHaveBeenCalledWith(expect.objectContaining({ cert: healthy.pem }));
  });
});
