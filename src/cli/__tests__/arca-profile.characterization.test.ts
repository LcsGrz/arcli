import { Command } from 'commander';
import { chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CertificateExpiredError } from '../../modules/config/certificate-expiry';
import { formatEnvironmentLabel, MISSING_CUIT_MESSAGE } from '../../modules/config/config.schemas';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { stripAnsi } from '../../ui';
import { exportCertificateWarnings, resolveArcaRuntime } from '../arca-runtime';
import {
  type BillingCommandGateways,
  executeBillingCommand,
  registerBillingCommandOptions,
} from '../commands/billing.command.shared';

import { PROFILE_CUIT, useArcaProfileFixture } from './arca-profile.fixture';

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

const profile = useArcaProfileFixture();

function mode(path: string): number {
  return statSync(path).mode & 0o777;
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

/** Vista previa de una factura C con el runtime real y ARCA falso: lo que sale en profile.stdout. */
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

  return profile.stdout;
}

beforeEach(() => {
  Arca.mockClear();
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
    profile.writeConfig({
      cert: { produccion: profile.other.certPath, testing: profile.healthy.certPath },
      cuit: PROFILE_CUIT,
      entornoPorDefecto: configured,
      key: { produccion: profile.other.keyPath, testing: profile.healthy.keyPath },
    });

    const runtime = resolveArcaRuntime(flags);

    expect(runtime.environment).toBe(expected);
    expect(runtime.context.production).toBe(expected === 'produccion');
    // Los PEM son los del entorno elegido, no los del otro.
    expect(runtime.context.cert).toBe((expected === 'produccion' ? profile.other : profile.healthy).pem);
  });

  it('sin entorno en la config usa testing', () => {
    profile.writeConfig({
      cert: { testing: profile.healthy.certPath },
      cuit: PROFILE_CUIT,
      key: { testing: profile.healthy.keyPath },
    });

    expect(resolveArcaRuntime({}).environment).toBe('testing');
  });

  it.each(['testing', 'produccion'] as const)(
    '--testing y --produccion juntos es un error de entrada, con entorno %s en la config',
    (configured) => {
      profile.writeConfig(profile.configWith(profile.healthy, { entornoPorDefecto: configured }));

      expect(() => resolveArcaRuntime({ produccion: true, testing: true })).toThrow(
        expect.objectContaining({
          code: 'INPUT_VALIDATION_ERROR',
          message: 'Usá `--testing` o `--produccion`, pero no ambos a la vez.',
        }),
      );
    },
  );

  it('--testing y --produccion juntos da error aunque falte el CUIT: el entorno se mira primero', () => {
    profile.writeConfig({});

    expect(() => resolveArcaRuntime({ produccion: true, testing: true })).toThrow(
      'Usá `--testing` o `--produccion`, pero no ambos a la vez.',
    );
  });
});

describe('CUIT', () => {
  it('sin CUIT: error de configuracion con el mensaje de siempre', () => {
    profile.writeConfig({ cert: { testing: profile.healthy.certPath }, key: { testing: profile.healthy.keyPath } });

    expect(() => resolveArcaRuntime({})).toThrow(
      expect.objectContaining({ code: 'CONFIGURATION_ERROR', message: MISSING_CUIT_MESSAGE }),
    );
  });

  it('con CUIT valido lo pasa como numero al contexto de ARCA', () => {
    profile.writeConfig(profile.configWith(profile.healthy));

    expect(resolveArcaRuntime({}).context.cuit).toBe(20123456786);
  });

  it('sin CUIT con --json: CONFIGURATION_ERROR en stderr, stdout vacio', async () => {
    profile.writeConfig({ cert: { testing: profile.healthy.certPath }, key: { testing: profile.healthy.keyPath } });

    expect(await profile.runJsonError(['estado'])).toMatchObject({
      codigo: 'CONFIGURATION_ERROR',
      error: MISSING_CUIT_MESSAGE,
    });
    expect(profile.stdout).toBe('');
  });

  it.each([
    ['con largo invalido', '2012345678'],
    ['no numerico', '2012345678X'],
  ])('%s en la config: lo frena el esquema de la config, con --json', async (_case, cuit) => {
    profile.writeConfig(profile.configWith(profile.healthy, { cuit }));

    expect(await profile.runJsonError(['estado'])).toEqual({
      codigo: 'INPUT_VALIDATION_ERROR',
      detalles: [{ mensaje: 'El CUIT debe tener 11 dígitos', ruta: ['cuit'] }],
      error: 'La configuración guardada tiene un dato inválido. `cuit`: el CUIT debe tener 11 dígitos.',
      sugerencia: 'Corregilo con `arcli config establecer cuit <valor>` o borralo con `arcli config eliminar cuit`.',
    });
    expect(profile.stdout).toBe('');
  });
});

describe('rutas del certificado y la clave', () => {
  it.each(['testing', 'produccion'] as const)('falta la ruta del certificado de %s', (environment) => {
    profile.writeConfig({
      cuit: PROFILE_CUIT,
      entornoPorDefecto: environment,
      key: { [environment]: profile.healthy.keyPath },
    });

    expect(() => resolveArcaRuntime({})).toThrow(
      expect.objectContaining({
        code: 'CONFIGURATION_ERROR',
        message: `Falta la ruta del certificado para ${formatEnvironmentLabel(environment)}. Configurala con \`arcli config establecer cert.${environment} <ruta>\`.`,
      }),
    );
  });

  it('falta la ruta de la clave', () => {
    profile.writeConfig({ cert: { testing: profile.healthy.certPath }, cuit: PROFILE_CUIT });

    expect(() => resolveArcaRuntime({})).toThrow(
      expect.objectContaining({
        code: 'CONFIGURATION_ERROR',
        message:
          'Falta la ruta de la clave privada para testing. Configurala con `arcli config establecer key.testing <ruta>`.',
      }),
    );
  });

  it('sin ninguna de las dos, se nombra primero el certificado', () => {
    profile.writeConfig({ cuit: PROFILE_CUIT });

    expect(() => resolveArcaRuntime({})).toThrow('Falta la ruta del certificado para testing.');
  });

  it('la ruta del certificado no existe: error con la ruta enmascarada', () => {
    const missing = join(profile.configDirectory, 'no-existe', 'cert.pem');

    profile.writeConfig({ cert: { testing: missing }, cuit: PROFILE_CUIT, key: { testing: profile.healthy.keyPath } });

    expect(() => resolveArcaRuntime({})).toThrow(
      expect.objectContaining({
        code: 'CONFIGURATION_ERROR',
        message: expect.stringMatching(/^La ruta del certificado no existe: \.{3}[\\/].*cert\.pem$/),
      }),
    );
  });

  it('la ruta de la clave no existe: error con la ruta enmascarada', () => {
    const missing = join(profile.configDirectory, 'no-existe', 'key.pem');

    profile.writeConfig({ cert: { testing: profile.healthy.certPath }, cuit: PROFILE_CUIT, key: { testing: missing } });

    expect(() => resolveArcaRuntime({})).toThrow(
      expect.objectContaining({
        code: 'CONFIGURATION_ERROR',
        message: expect.stringMatching(/^La ruta de la clave privada no existe: \.{3}[\\/].*key\.pem$/),
      }),
    );
  });

  it('el certificado no existe, con --json: CONFIGURATION_ERROR con la ruta enmascarada', async () => {
    profile.writeConfig({
      cert: { testing: join(profile.configDirectory, 'cert.pem') },
      cuit: PROFILE_CUIT,
      key: { testing: profile.healthy.keyPath },
    });

    const error = await profile.runJsonError(['estado']);

    expect(error).toMatchObject({
      codigo: 'CONFIGURATION_ERROR',
      error: expect.stringMatching(/^La ruta del certificado no existe: /),
    });
    expect(JSON.stringify(error)).not.toContain(profile.configDirectory);
  });

  it('el certificado no es PEM: error de formato', () => {
    const notPem = join(profile.configDirectory, 'cert.pem');

    writeFileSync(notPem, 'no es un certificado', 'utf8');
    profile.writeConfig({ cert: { testing: notPem }, cuit: PROFILE_CUIT, key: { testing: profile.healthy.keyPath } });

    expect(() => resolveArcaRuntime({})).toThrow(/formato PEM inválido/);
  });

  it('arma el contexto con los PEM leidos y el punto de venta de la config', () => {
    profile.writeConfig(profile.configWith(profile.healthy, { puntoVentaPorDefecto: 7 }));

    const runtime = resolveArcaRuntime({});

    expect(runtime.pointOfSale).toBe(7);
    expect(runtime.context).toMatchObject({ cert: profile.healthy.pem, cuit: 20123456786, production: false });
    expect(runtime.context.key).toContain('PRIVATE KEY');
    expect(runtime.config.cuit).toBe(PROFILE_CUIT);
  });

  it('sin punto de venta en la config queda sin definir', () => {
    profile.writeConfig(profile.configWith(profile.healthy));

    expect(resolveArcaRuntime({}).pointOfSale).toBeUndefined();
  });
});

describe('tickets de ARCA', () => {
  it('por defecto, en la carpeta tickets junto a la config', () => {
    profile.writeConfig(profile.configWith(profile.healthy));

    expect(resolveArcaRuntime({}).context.ticketPath).toBe(join(profile.configDirectory, 'tickets'));
  });

  it('con ticketPath en la config, ese', () => {
    const custom = join(profile.configDirectory, 'mis-tickets');

    profile.writeConfig(profile.configWith(profile.healthy, { ticketPath: custom }));

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
    profile.writeConfig(profile.configWith(profile.healthy, { output: { jsonPorDefecto: configured } }));

    expect(resolveArcaRuntime(flag === undefined ? {} : { json: flag }).outputJson).toBe(expected);
  });

  it.each([
    [undefined, false, false],
    [undefined, true, true],
    [true, false, true],
    [false, true, false],
  ])('bruto flag %s, config %s: %s', (flag, configured, expected) => {
    profile.writeConfig(profile.configWith(profile.healthy, { output: { brutoPorDefecto: configured } }));

    expect(resolveArcaRuntime(flag === undefined ? {} : { bruto: flag }).outputRaw).toBe(expected);
  });

  it('json y bruto son independientes', () => {
    profile.writeConfig(
      profile.configWith(profile.healthy, { output: { brutoPorDefecto: true, jsonPorDefecto: false } }),
    );

    expect(resolveArcaRuntime({ json: true })).toMatchObject({ outputJson: true, outputRaw: true });
  });
});

describe.skipIf(process.platform === 'win32')('permisos de las carpetas', () => {
  it('deja en 0700 la carpeta de la config y la de los tickets en cada resolucion', () => {
    const tickets = join(profile.configDirectory, 'tickets');

    profile.writeConfig(profile.configWith(profile.healthy));
    mkdirSync(tickets);
    chmodSync(profile.configDirectory, 0o755);
    chmodSync(tickets, 0o755);

    resolveArcaRuntime({});

    expect(mode(profile.configDirectory)).toBe(0o700);
    expect(mode(tickets)).toBe(0o700);

    chmodSync(profile.configDirectory, 0o755);
    chmodSync(tickets, 0o755);
    resolveArcaRuntime({});

    expect(mode(profile.configDirectory)).toBe(0o700);
    expect(mode(tickets)).toBe(0o700);
  });

  it('restringe la carpeta de tickets configurada, no la de por defecto', () => {
    const custom = join(profile.temporaryDirectory('arcli-tickets-'), 'tickets');
    const defaultTickets = join(profile.configDirectory, 'tickets');

    mkdirSync(custom);
    mkdirSync(defaultTickets);
    chmodSync(custom, 0o755);
    chmodSync(defaultTickets, 0o755);
    profile.writeConfig(profile.configWith(profile.healthy, { ticketPath: custom }));

    resolveArcaRuntime({});

    expect(mode(custom)).toBe(0o700);
    expect(mode(defaultTickets)).toBe(0o755);
  });

  it('restringe antes de leer los certificados: tambien si el certificado no existe', () => {
    const tickets = join(profile.configDirectory, 'tickets');

    profile.writeConfig({
      cert: { testing: join(profile.configDirectory, 'cert.pem') },
      cuit: PROFILE_CUIT,
      key: { testing: profile.healthy.keyPath },
    });
    mkdirSync(tickets);
    chmodSync(profile.configDirectory, 0o755);
    chmodSync(tickets, 0o755);

    expect(() => resolveArcaRuntime({})).toThrow(/no existe/);
    expect(mode(profile.configDirectory)).toBe(0o700);
    expect(mode(tickets)).toBe(0o700);
  });

  it('no crea la carpeta de tickets si no existe', () => {
    profile.writeConfig(profile.configWith(profile.healthy));

    resolveArcaRuntime({});

    expect(() => statSync(join(profile.configDirectory, 'tickets'))).toThrow();
  });
});

describe('vencimiento del certificado', () => {
  it('sano: sin aviso en stderr ni en el runtime', () => {
    profile.writeConfig(profile.configWith(profile.healthy));

    const runtime = resolveArcaRuntime({});

    expect(runtime.certificateExpiry).toBeUndefined();
    expect(runtime.certificateNotices).toEqual([]);
    expect(profile.stdout + profile.stderr).toBe('');
  });

  it('por vencer, sin --json: aviso en stderr y stdout limpio', () => {
    profile.writeConfig(profile.configWith(profile.expiring));

    const runtime = resolveArcaRuntime({});

    expect(runtime.certificateExpiry).toMatchObject({ environment: 'testing', expired: false });
    expect(profile.stdout).toBe('');
    expect(stripAnsi(profile.stderr)).toMatch(
      /El certificado de testing vence el \d{2}\/\d{2}\/\d{4} \(en (9|10) días\)\./,
    );
  });

  it('por vencer, con --json: el aviso sigue en stderr y stdout limpio', () => {
    profile.writeConfig(profile.configWith(profile.expiring));

    resolveArcaRuntime({ json: true });

    expect(profile.stdout).toBe('');
    expect(stripAnsi(profile.stderr)).toContain('El certificado de testing vence el');
  });

  it('vencido, sin --json: aviso de vencido en stderr, sin cortar la resolucion', () => {
    profile.writeConfig(profile.configWith(profile.expiring));
    profile.moveClockAfterExpiry(profile.expiring, 5);

    const runtime = resolveArcaRuntime({});

    expect(runtime.certificateExpiry).toMatchObject({ environment: 'testing', expired: true });
    expect(stripAnsi(profile.stderr)).toMatch(/El certificado de testing venció el \d{2}\/\d{2}\/\d{4}\./);
  });

  it('vencido, con --json: nada en stderr al resolver (lo dice el error JSON)', () => {
    profile.writeConfig(profile.configWith(profile.expiring));
    profile.moveClockAfterExpiry(profile.expiring, 5);

    resolveArcaRuntime({ json: true });

    expect(profile.stdout + profile.stderr).toBe('');
  });

  it('vencido, con --json en un comando: un solo JSON de error CERTIFICATE_EXPIRED, sin llegar a ARCA', async () => {
    profile.writeConfig(profile.configWith(profile.expiring));
    profile.moveClockAfterExpiry(profile.expiring, 5);

    expect(await profile.runJsonError(['estado'])).toMatchObject({
      codigo: 'CERTIFICATE_EXPIRED',
      error: expect.stringContaining('venció'),
    });
    expect(profile.stdout).toBe('');
    expect(Arca).not.toHaveBeenCalled();
  });

  it('avisa el de produccion por vencer trabajando en testing, sin aviso del entorno activo', () => {
    profile.writeConfig({
      cert: { produccion: profile.expiring.certPath, testing: profile.healthy.certPath },
      cuit: PROFILE_CUIT,
      key: { testing: profile.healthy.keyPath },
    });

    const runtime = resolveArcaRuntime({});

    expect(runtime.certificateExpiry).toBeUndefined();
    expect(runtime.certificateNotices).toEqual([
      expect.objectContaining({ environment: 'produccion', expired: false }),
    ]);
    expect(stripAnsi(profile.stderr)).toContain('El certificado de producción vence el');
  });

  it('con --json, la vista previa suma el aviso a "avisos"', async () => {
    profile.writeConfig(profile.configWith(profile.expiring));

    const output = JSON.parse(await previewInvoice('--json')) as { avisos?: string[] };

    expect(output.avisos).toEqual(
      expect.arrayContaining([expect.stringMatching(/^El certificado de testing vence el .* Renovalo: /)]),
    );
    expect(stripAnsi(profile.stderr)).toContain('El certificado de testing vence el');
  });

  it('sin --json, el aviso no se repite en la salida del comando', async () => {
    profile.writeConfig(profile.configWith(profile.expiring));

    const output = stripAnsi(await previewInvoice());

    expect(output).toContain('FACTURA C');
    expect(output).not.toContain('El certificado de testing vence el');
    expect(stripAnsi(profile.stderr)).toContain('El certificado de testing vence el');
  });
});

describe('factura E: certificado de exportacion', () => {
  it('sin certificado dedicado, WSFEX usa el mismo contexto que facturacion', () => {
    profile.writeConfig(profile.configWith(profile.healthy));

    const runtime = resolveArcaRuntime({});

    new ArcaClientFactory().createForExport(runtime);

    expect(Arca).toHaveBeenCalledWith(runtime.context);
  });

  it('con certificado dedicado, WSFEX usa sus PEM y el resto del contexto de facturacion', () => {
    profile.writeConfig(
      profile.configWith(profile.healthy, {
        exportacion: { cert: { testing: profile.other.certPath }, key: { testing: profile.other.keyPath } },
      }),
    );

    const runtime = resolveArcaRuntime({});

    new ArcaClientFactory().createForExport(runtime);

    expect(runtime.context.cert).toBe(profile.healthy.pem);
    expect(Arca).toHaveBeenCalledWith({
      ...runtime.context,
      cert: profile.other.pem,
      key: expect.stringContaining('PRIVATE KEY'),
    });
    expect(Arca.mock.calls[0]?.[0]).toMatchObject({
      cuit: 20123456786,
      production: false,
      ticketPath: join(profile.configDirectory, 'tickets'),
    });
  });

  it('el gateway de WSFEX tambien usa el certificado dedicado', () => {
    profile.writeConfig(
      profile.configWith(profile.healthy, {
        exportacion: { cert: { testing: profile.other.certPath }, key: { testing: profile.other.keyPath } },
      }),
    );

    new ArcaClientFactory().createExportGateway(resolveArcaRuntime({}));

    expect(Arca).toHaveBeenCalledWith(expect.objectContaining({ cert: profile.other.pem }));
  });

  it('sin dedicado y con el certificado de facturacion vencido: corta antes de crear el cliente', () => {
    profile.writeConfig(profile.configWith(profile.expiring));
    profile.moveClockAfterExpiry(profile.expiring, 5);

    const runtime = resolveArcaRuntime({});

    expect(() => new ArcaClientFactory().createForExport(runtime)).toThrow(CertificateExpiredError);
    expect(Arca).not.toHaveBeenCalled();
  });

  it('con dedicado vencido: corta aunque el de facturacion este sano', () => {
    profile.writeConfig(
      profile.configWith(profile.healthy, {
        exportacion: { cert: { testing: profile.expiring.certPath }, key: { testing: profile.expiring.keyPath } },
      }),
    );
    profile.moveClockAfterExpiry(profile.expiring, 5);

    const runtime = resolveArcaRuntime({});

    expect(runtime.certificateExpiry).toBeUndefined();
    expect(() => new ArcaClientFactory().createForExport(runtime)).toThrow(CertificateExpiredError);
    expect(Arca).not.toHaveBeenCalled();
  });

  it('el mismo archivo como par propio: banner y error, los del general (ARQ-22)', () => {
    profile.writeConfig(
      profile.configWith(profile.expiring, {
        exportacion: { cert: { testing: profile.expiring.certPath }, key: { testing: profile.expiring.keyPath } },
      }),
    );
    profile.moveClockAfterExpiry(profile.expiring, 5);

    const runtime = resolveArcaRuntime({}, { service: 'wsfex' });

    expect(stripAnsi(profile.stderr)).toContain('El certificado de testing venció');
    expect(() => new ArcaClientFactory().createForExport(runtime)).toThrow(/^El certificado de testing venció/);
  });

  it('con dedicado sano: sigue aunque el de facturacion este vencido', () => {
    profile.writeConfig(
      profile.configWith(profile.expiring, {
        exportacion: { cert: { testing: profile.other.certPath }, key: { testing: profile.other.keyPath } },
      }),
    );
    profile.moveClockAfterExpiry(profile.expiring, 5);

    new ArcaClientFactory().createForExport(resolveArcaRuntime({}));

    expect(Arca).toHaveBeenCalledWith(expect.objectContaining({ cert: profile.other.pem }));
  });

  it('por vencer, el dedicado se avisa en los comandos, y la E no avisa el general (ARQ-22)', () => {
    profile.writeConfig(
      profile.configWith(profile.expiring, {
        exportacion: { cert: { testing: profile.other.certPath }, key: { testing: profile.other.keyPath } },
      }),
    );

    expect(resolveArcaRuntime({}, { service: 'wsfex' }).certificateExpiry).toMatchObject({ environment: 'testing' });
    expect(stripAnsi(profile.stderr)).not.toContain('El certificado de testing vence');

    profile.writeConfig(
      profile.configWith(profile.healthy, {
        exportacion: { cert: { testing: profile.expiring.certPath }, key: { testing: profile.expiring.keyPath } },
      }),
    );

    // Tambien en los comandos de A, B y C, sin ser el suyo.
    expect(resolveArcaRuntime({}).certificateExpiry).toBeUndefined();
    expect(stripAnsi(profile.stderr)).toContain('El certificado de exportación de testing vence el');
  });

  it('con --json y el general vencido, la E con par propio sigue y avisa solo lo suyo (ARQ-22)', () => {
    profile.writeConfig(
      profile.configWith(profile.expiring, {
        exportacion: { cert: { testing: profile.other.certPath }, key: { testing: profile.other.keyPath } },
      }),
    );
    profile.moveClockAfterExpiry(profile.expiring, 5);

    const runtime = resolveArcaRuntime({ json: true }, { service: 'wsfex' });

    expect(exportCertificateWarnings(runtime).join()).not.toContain('El certificado de testing');
  });

  it('dedicado a medias (solo el certificado): error de configuracion que nombra la clave que falta', () => {
    profile.writeConfig(
      profile.configWith(profile.healthy, { exportacion: { cert: { testing: profile.other.certPath } } }),
    );

    expect(() => new ArcaClientFactory().createForExport(resolveArcaRuntime({}))).toThrow(
      expect.objectContaining({
        code: 'CONFIGURATION_ERROR',
        details: { faltan: ['exportacion.key.testing'] },
        message: 'Para WSFEX en testing configurá el certificado y la clave juntos.',
      }),
    );
  });

  it('el dedicado es por entorno: el de produccion no se usa en testing', () => {
    profile.writeConfig(
      profile.configWith(profile.healthy, {
        exportacion: { cert: { produccion: profile.other.certPath }, key: { produccion: profile.other.keyPath } },
      }),
    );

    new ArcaClientFactory().createForExport(resolveArcaRuntime({}));

    expect(Arca).toHaveBeenCalledWith(expect.objectContaining({ cert: profile.healthy.pem }));
  });
});
