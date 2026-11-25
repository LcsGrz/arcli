import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useArcaDeadlines } from '../../testing/arca-deadlines';
import type { ArcaBehavior } from '../../testing/arca-server';
import { reportCliError } from '../error-output';
import { finishCut, REPEATED_SIGNAL_MS } from '../interruption';
import { createProgram } from '../program';

import { useArcaProfileFixture } from './arca-profile.fixture';

/**
 * ARQ-11: lo que ve quien usa el CLI, y lo que recibe ARCA, si una llamada vence. El CLI entero con el SDK de verdad
 * contra un ARCA local que no contesta; los plazos se acortan 100 veces.
 */
vi.setConfig({ testTimeout: 30_000 });

const profile = useArcaProfileFixture();
const arca = useArcaDeadlines();

const CLIENT_CUIT = '30709965812';
const DENIED = /no se emitió|no se envió/i;

const FC = ['fc', '-m', '1000', '--cs', '--cfinal'];
const TO_CUIT = ['-m', '12100', '--cs', '--cuit', CLIENT_CUIT];
const FE = [
  ...['fe', '--cliente', 'ACME LLC', '--domicilio-cliente', '123 Main St', '--pais-destino', '212'],
  ...['--cuit-pais', '55000002126', '-m', '1500', '--moneda', 'PES', '--item', '001|Consultoría|1|1500|7'],
];
const FE_GOODS = [
  ...FE,
  ...['--tipo-expo', '1', '--incoterm', 'FOB', '--permiso-existente', '--permiso', '26001EC01000123A'],
];

interface Run {
  readonly error: Record<string, unknown> | undefined;
  readonly stderr: string;
  readonly stdout: string;
}

interface JsonVoucher {
  readonly avisos: readonly string[];
  readonly cae: string | null;
  readonly numero: number | null;
}

/** Cada test, su CUIT: el almacenamiento de tickets es por CUIT. */
let cuit = 20123456700;

beforeEach(() => {
  cuit += 1;
  profile.writeConfig({
    cert: { testing: arca.certPath },
    consultarPadron: false,
    cuit: String(cuit),
    exportacion: { actividad: 620100 },
    key: { testing: arca.keyPath },
    pdf: 'nunca',
    puntoVentaPorDefecto: 3,
    verificarFce: true,
  });
});

/** Corre el CLI con `--json` y muestra el error como `index.ts`. Si queda colgado, el test falla acá. */
async function run(args: readonly string[]): Promise<Run> {
  async function execute(): Promise<unknown> {
    try {
      await createProgram().parseAsync(['node', 'arcli', ...args, '--json']);
    } catch (error) {
      reportCliError(error, true);

      return error;
    } finally {
      await finishCut();
    }

    return undefined;
  }

  const settled = await arca.settle(execute());

  expect(settled).toMatchObject({ end: 'contestó' });

  return {
    error: profile.stderr.trim() ? (JSON.parse(profile.stderr) as Record<string, unknown>) : undefined,
    stderr: profile.stderr,
    stdout: profile.stdout,
  };
}

const hang = (operation: string, call?: number, behavior: ArcaBehavior = 'cuelga') =>
  arca.server.respond((name, nth) =>
    name === operation && (call === undefined || nth === call) ? behavior : undefined,
  );

const voucher = (result: Run) => JSON.parse(result.stdout) as JsonVoucher;

/** El aviso de lo que venció, con el motivo. */
const expiredWarnings = (result: Run) =>
  voucher(result).avisos.filter((warning) => warning.includes('ARCA no contestó en 30 segundos'));

const details = (result: Run) => result.error?.detalles as Record<string, unknown>;

const requested = (operation: string) => arca.server.count(operation);

describe('sin nada vencido', () => {
  it.each([
    ['fc', FC, 'FECAESolicitar', 42],
    ['fe', FE, 'FEXAuthorize', 8],
  ] as const)('%s: emite una vez, con todas sus consultas', async (_name, args, operation, numero) => {
    const result = await run([...args, '--emitir']);

    expect(result.stderr).toBe('');
    expect(voucher(result)).toMatchObject({ cae: '75123456789012', numero });
    expect(requested(operation)).toBe(1);
  });

  it('una emisión que tarda menos que el plazo da su CAE', async () => {
    hang('FECAESolicitar', 1, 700);

    expect(voucher(await run([...FC, '--emitir']))).toMatchObject({ cae: '75123456789012' });
    expect(requested('FECAESolicitar')).toBe(1);
  });
});

describe('la emisión vencida', () => {
  it.each([
    ['fa', ['fa', ...TO_CUIT, '--ir-ri'], 'FECAESolicitar', 42, 1],
    ['fb', ['fb', '-m', '1210', '--cs', '--cfinal'], 'FECAESolicitar', 42, 6],
    ['fc', FC, 'FECAESolicitar', 42, 11],
    ['fe', FE, 'FEXAuthorize', 8, 19],
  ] as const)(
    '%s: EMISSION_UNCERTAIN, con el número y un solo pedido',
    async (_name, args, operation, numero, tipo) => {
      hang(operation);

      const result = await run([...args, '--emitir']);

      expect(result.error).toMatchObject({
        codigo: 'EMISSION_UNCERTAIN',
        detalles: { entorno: 'testing', numero, puntoVenta: 3, tipoArca: tipo },
      });
      expect(details(result).causa).toContain('no contestó en 120 segundos');
      expect(result.stderr).not.toMatch(DENIED);
      expect(result.stdout).toBe('');
      expect(requested(operation)).toBe(1);
    },
  );

  it('que gotea: lo mismo, el plazo es total y no por inactividad', async () => {
    hang('FECAESolicitar', undefined, 'gotea');

    const result = await run([...FC, '--emitir']);

    expect(result.error).toMatchObject({ codigo: 'EMISSION_UNCERTAIN', detalles: { numero: 42 } });
    expect(requested('FECAESolicitar')).toBe(1);
  });

  it('en la E lleva también la solicitud', async () => {
    hang('FEXAuthorize');
    expect(details(await run([...FE, '--emitir']))).toMatchObject({ idSolicitud: 42, numero: 8 });
  });

  it('en un lote: el 2.º queda sin confirmar, el 3.º no se pide y el 1.º se entrega', async () => {
    const path = join(profile.configDirectory, 'lote.json');
    const item = {
      concepto: 'servicios',
      ivaReceptor: 'consumidor-final',
      montoTotal: 1000,
      tipoDocumento: 'consumidor-final',
    };

    writeFileSync(path, JSON.stringify([item, item, item]));
    hang('FECAESolicitar', 2);

    const result = await run(['fc', '--cargar', path, '--emitir']);

    expect((JSON.parse(result.stdout) as JsonVoucher[]).map(({ numero }) => numero)).toEqual([42]);
    expect(result.error).toMatchObject({
      codigo: 'BATCH_EMISSION_ERROR',
      detalles: {
        codigoCausa: 'EMISSION_UNCERTAIN',
        fallo: 2,
        numero: 43,
        procesados: 1,
        sinConfirmar: 2,
        sinProcesar: [3],
        total: 3,
      },
    });
    expect(requested('FECAESolicitar')).toBe(2);
    expect(requested('FECompUltimoAutorizado')).toBe(2);
  });
});

describe('vencido lo de antes de emitir', () => {
  it.each([
    ['el último número', FC, 'FECompUltimoAutorizado', 30, 'FECAESolicitar'],
    ['el último número de la E', FE, 'FEXGetLast_CMP', 30, 'FEXAuthorize'],
    ['el último ID de la E', FE, 'FEXGetLast_ID', 30, 'FEXAuthorize'],
    ['el login', FC, 'loginCms', 60, 'FECAESolicitar'],
    ['el login de la E', FE, 'loginCms', 60, 'FEXAuthorize'],
  ] as const)('%s: no es incierto y no se emitió', async (_name, args, operation, seconds, emission) => {
    hang(operation);

    const result = await run([...args, '--emitir']);

    expect(result.error).toMatchObject({
      codigo: 'UNEXPECTED_ERROR',
      error: expect.stringContaining(`no contestó en ${seconds} segundos`) as string,
    });
    expect(result.stdout).toBe('');
    expect(requested(operation)).toBe(1);
    expect(requested(emission)).toBe(0);
  });
});

describe('vencido el login que el SDK pide dentro de la llamada que emite', () => {
  it.each([
    ['fc', FC, 'FECompUltimoAutorizado', 'FECAESolicitar', 42],
    ['fe', FE, 'FEXGetLast_ID', 'FEXAuthorize', 8],
  ] as const)(
    '%s: no se distingue de la emisión, así que queda sin confirmar',
    async (_name, args, last, emission, numero) => {
      let expired = false;

      // El ticket deja de estar después de pedir los números: la emisión vuelve a pedir el login.
      arca.server.respond((operation) => {
        if (operation === last) {
          rmSync(join(profile.configDirectory, 'tickets'), { force: true, recursive: true });
          expired = true;
        }

        return expired && operation === 'loginCms' ? 'cuelga' : undefined;
      });

      const result = await run([...args, '--emitir']);

      expect(result.error).toMatchObject({ codigo: 'EMISSION_UNCERTAIN', detalles: { numero } });
      expect(details(result).causa).toContain('WSAA no contestó en 60 segundos');
      expect(requested(emission)).toBe(0);
    },
  );
});

describe('las tablas de la E', () => {
  const preview = [...FE, '--previsualizar'];

  it('una vencida avisa y sigue', async () => {
    hang('FEXGetPARAM_Idiomas');

    const result = await run(preview);

    expect(result.error).toBeUndefined();
    expect(expiredWarnings(result)).toEqual([expect.stringContaining('la tabla de idiomas') as string]);
    expect(requested('FEXGetPARAM_Idiomas')).toBe(1);
  });

  it('dos vencidas cortan, y no se emite', async () => {
    arca.server.respond((operation) =>
      ['FEXGetPARAM_Idiomas', 'FEXGetPARAM_MON'].includes(operation) ? 'cuelga' : undefined,
    );

    expect((await run([...FE, '--emitir'])).error).toMatchObject({
      codigo: 'UNEXPECTED_ERROR',
      error: expect.stringContaining('no contestó en 30 segundos') as string,
    });
    expect(requested('FEXAuthorize')).toBe(0);
  });

  it('una obligatoria corta, y no se emite', async () => {
    hang('FEXGetPARAM_Incoterms');

    expect((await run([...FE_GOODS, '--emitir'])).error).toMatchObject({
      codigo: 'UNEXPECTED_ERROR',
      error: expect.stringContaining('no contestó en 30 segundos') as string,
    });
    expect(requested('FEXAuthorize')).toBe(0);
  });

  it('los países, que son obligatorios, cortan antes de pedir otra tabla', async () => {
    hang('FEXGetPARAM_DST_pais');

    expect((await run(preview)).error).toMatchObject({ codigo: 'UNEXPECTED_ERROR' });
    expect(arca.server.requests.map(({ operation }) => operation)).toEqual(['loginCms', 'FEXGetPARAM_DST_pais']);
  });

  it('el permiso vencido avisa y sigue', async () => {
    hang('FEXCheck_Permiso');

    const result = await run([...FE_GOODS, '--previsualizar']);

    expect(result.error).toBeUndefined();
    expect(expiredWarnings(result)).toEqual([expect.stringContaining('permiso de embarque') as string]);
  });

  it('una tabla y el permiso, vencidos, cortan', async () => {
    arca.server.respond((operation) =>
      ['FEXCheck_Permiso', 'FEXGetPARAM_Idiomas'].includes(operation) ? 'cuelga' : undefined,
    );

    expect((await run([...FE_GOODS, '--emitir'])).error).toMatchObject({ codigo: 'UNEXPECTED_ERROR' });
    expect(requested('FEXAuthorize')).toBe(0);
  });
});

describe('las consultas que solo avisan, avisan si vencen', () => {
  it('el régimen FCE', async () => {
    hang('consultarMontoObligadoRecepcion');

    const result = await run(['fa', ...TO_CUIT, '--ir-ri', '--previsualizar']);

    expect(result.error).toBeUndefined();
    expect(expiredWarnings(result)).toEqual([expect.stringContaining('régimen FCE') as string]);
  });

  it('el rango de la cotización', async () => {
    hang('FEParamGetCotizacion');

    const result = await run([...FC, '--mda', 'USD', '--cm', '1450', '--previsualizar']);

    expect(result.error).toBeUndefined();
    expect(expiredWarnings(result)).toEqual([expect.stringContaining('la cotización') as string]);
  });

  it('el padrón, con un IVA receptor en la config', async () => {
    profile.writeConfig({
      cert: { testing: arca.certPath },
      cuit: String(cuit),
      ivaReceptorPorDefecto: 'responsable-inscripto',
      key: { testing: arca.keyPath },
      pdf: 'nunca',
      puntoVentaPorDefecto: 3,
    });
    hang('getPersona_v2');

    const result = await run(['fa', ...TO_CUIT, '--previsualizar']);

    expect(result.error).toBeUndefined();
    expect(expiredWarnings(result)).toEqual([expect.stringContaining('padrón') as string]);
  });
});

describe('una consulta vencida', () => {
  it.each([
    ['ultimos', ['ultimos', 'fc'], 'FECompUltimoAutorizado'],
    ['ultimos de la E', ['ultimos', 'fe'], 'FEXGetLast_CMP'],
    ['consultar', ['consultar', 'fc', '12'], 'FECompConsultar'],
    ['padron', ['padron', CLIENT_CUIT], 'getPersona_v2'],
    ['parametros', ['parametros', 'monedas'], 'FEParamGetTiposMonedas'],
  ] as const)('%s: UNEXPECTED_ERROR con el texto en español', async (_name, args, operation) => {
    hang(operation);

    const result = await run(args);

    expect(result.error).toMatchObject({
      codigo: 'UNEXPECTED_ERROR',
      error: 'ARCA no contestó en 30 segundos.',
    });
    expect(result.stderr).not.toMatch(DENIED);
    expect(result.stdout).toBe('');
    expect(requested(operation)).toBe(1);
  });

  it('estado sigue dando ARCA_UNAVAILABLE', async () => {
    hang('FEDummy');

    expect((await run(['estado'])).error).toMatchObject({
      codigo: 'ARCA_UNAVAILABLE',
      error: 'ARCA no respondió: ARCA no contestó en 30 segundos.',
    });
  });

  it('en estado, WSFEX colgado no cambia lo demás', async () => {
    hang('FEXDummy');

    const { setTimeout: startTimer } = globalThis;
    // El tope de los dummy, que sigue siendo suyo: 5 segundos, acortados igual.
    const timers = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((done: () => void, ms?: number) =>
        startTimer(done, ms === 5_000 ? 50 : ms)) as typeof setTimeout);

    const result = await run(['estado']);

    timers.mockRestore();
    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.stdout)).toMatchObject({ servidores: { aplicacion: 'OK' } });
    await vi.waitFor(() =>
      expect(arca.server.requests.find(({ operation }) => operation === 'FEXDummy')?.dropped).toBe(true),
    );
  });
});

describe('con Ctrl+C', () => {
  const written = () => profile.stdout + profile.stderr;

  /** Manda las señales cuando ARCA ya recibió la emisión. */
  async function interrupt(times: number): Promise<void> {
    await vi.waitFor(() => expect(requested('FECAESolicitar')).toBe(1), { interval: 5, timeout: 5_000 });

    const now = performance.now();
    const clock = vi.spyOn(performance, 'now');

    for (let sent = 0; sent < times; sent += 1) {
      clock.mockReturnValue(now + sent * REPEATED_SIGNAL_MS);
      process.emit('SIGINT', 'SIGINT');
      await pause(5);
    }

    clock.mockRestore();
  }

  beforeEach(() => {
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    hang('FECAESolicitar');
  });

  it('uno solo y después vence: EMISSION_UNCERTAIN, una vez', async () => {
    const [result] = await Promise.all([run([...FC, '--emitir']), interrupt(1)]);

    expect(result.error).toMatchObject({ codigo: 'EMISSION_UNCERTAIN', detalles: { numero: 42 } });
    expect(details(result).causa).toContain('no contestó en 120 segundos');
    expect(requested('FECAESolicitar')).toBe(1);
  });

  it('el segundo antes de que venza: gana el corte, y el vencimiento no escribe nada más', async () => {
    const unhandled = vi.fn();

    process.on('unhandledRejection', unhandled);

    try {
      const [result] = await Promise.all([run([...FC, '--emitir']), interrupt(2)]);
      const atEnd = written();

      expect(result.error).toMatchObject({ codigo: 'EMISSION_UNCERTAIN', detalles: { numero: 42 } });
      expect(details(result).causa).not.toContain('120 segundos');
      // Más que el plazo, acortado.
      await pause(1_500);
      expect(written()).toBe(atEnd);
      expect(unhandled).not.toHaveBeenCalled();
      expect(requested('FECAESolicitar')).toBe(1);
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('vencida, una señal tardía corta como siempre: no queda nadie atajándola', async () => {
    const before = process.listenerCount('SIGINT');
    const result = await run([...FC, '--emitir']);

    expect(result.error).toMatchObject({ codigo: 'EMISSION_UNCERTAIN' });
    expect(process.listenerCount('SIGINT')).toBe(before);
  });
});
