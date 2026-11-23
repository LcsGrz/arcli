import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { arcliConfigSchema } from '../../../modules/config/config.schemas';
import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_VOUCHER_KIND,
  type ExportGateway,
  type ExportIssuedVoucher,
  type ExportVoucherKind,
} from '../../../modules/export/export.types';
import type { IFEXAuthorizeOutput } from '../../../services/arca/arca-sdk.types';
import type { CliArcaRuntime } from '../../arca-runtime';
import { registerGlobalOptions } from '../../global-options';
import { chooseOne } from '../../interactive/prompts';
import { executeExportCommand, type ExportCommandDependencies } from '../export.command';
import { registerExportOptions } from '../export.command.options';

const spinner = { stop: vi.fn() };

vi.mock('../../spinner', () => ({ startSpinner: () => spinner }));
// En una terminal sin flags de emision el comando pregunta; aca se contesta desde cada test.
vi.mock('../../interactive/prompts', async (original) => ({
  ...(await original<typeof import('../../interactive/prompts')>()),
  chooseOne: vi.fn(),
}));

/** Lo que devuelve FEXAuthorize, recortado a lo que lee arcli. */
function authorization(result: 'A' | 'R'): IFEXAuthorizeOutput {
  return {
    FEXAuthorizeResult: {
      FEXErr: { ErrCode: 0, ErrMsg: '' },
      FEXEvents: { EventCode: 0, EventMsg: '' },
      FEXResultAuth: {
        Cae: result === 'A' ? '75123456789012' : '',
        Cbte_nro: 1,
        Cbte_tipo: 19,
        Cuit: 20111111112,
        Fch_cbte: '20261101',
        Fch_venc_Cae: result === 'A' ? '20261111' : '',
        Id: 8,
        Motivos_Obs: '',
        Punto_vta: 4,
        Reproceso: 'N',
        Resultado: result,
      },
    },
  } as IFEXAuthorizeOutput;
}

/** La factura que ajusta la nota de credito, como la devuelve FEXGetCMP. */
const ASSOCIATED_INVOICE: ExportIssuedVoucher = {
  activities: [620100],
  arcaType: 19,
  clientAddress: '123 Main St',
  clientCountryCuit: 55000002126,
  clientName: 'ACME LLC',
  currencyCode: 'DOL',
  date: '20261030',
  destinationCountry: 212,
  exchangeRate: 1000,
  exportType: 2,
  language: 1,
  number: 1,
  paymentTerms: 'Transferencia Internacional',
  pointOfSale: 4,
  result: 'A',
  total: 1500,
};

function gateway(overrides: Partial<ExportGateway> = {}): ExportGateway {
  return {
    authorize: vi.fn(async () => authorization('A')),
    checkPermit: vi.fn(async () => 'OK'),
    getActivities: vi.fn(async () => [{ id: 620100, name: 'SERVICIOS DE CONSULTORES EN INFORMATICA' }]),
    getCurrencies: vi.fn(async () => [{ code: 'DOL', name: 'Dólar Estadounidense' }]),
    getDestinationCountries: vi.fn(async () => [{ code: 212, name: 'ESTADOS UNIDOS' }]),
    getDestinationCountryCuits: vi.fn(async () => [
      { countryName: 'ESTADOS UNIDOS - Persona Jurídica', cuit: 55000002126 },
    ]),
    getIncoterms: vi.fn(async () => [{ code: 'FOB', name: 'Free on Board' }]),
    getLanguages: vi.fn(async () => [{ id: 1, name: 'Espanol' }]),
    getLastRequestId: vi.fn(async () => 7),
    getLastVoucherNumber: vi.fn(async () => 0),
    getQuotations: vi.fn(async () => []),
    getUnits: vi.fn(async () => [{ id: 7, name: 'unidades' }]),
    getVoucher: vi.fn(async () => ASSOCIATED_INVOICE),
    ...overrides,
  };
}

function runtime(outputJson: boolean, config: Record<string, unknown>): CliArcaRuntime {
  return {
    certificateNotices: [],
    config: arcliConfigSchema.parse({
      cuit: '20111111112',
      exportacion: { actividad: 620100 },
      pdf: 'nunca',
      puntoVentaPorDefecto: 4,
      ...config,
    }),
    context: { cuit: 20111111112 },
    cuit: 20111111112,
    environment: 'testing',
    outputJson,
    outputRaw: false,
    pointOfSale: 4,
  } as unknown as CliArcaRuntime;
}

let stdout = '';

async function run(
  args: readonly string[],
  options: {
    readonly config?: Record<string, unknown>;
    readonly gateway?: ExportGateway;
    readonly json?: boolean;
    readonly voucherKind?: ExportVoucherKind;
  } = {},
): Promise<ExportGateway> {
  const voucherKind = options.voucherKind ?? EXPORT_VOUCHER_KIND;
  const command = new Command(voucherKind.shortcut);
  const used = options.gateway ?? gateway();
  const dependencies: ExportCommandDependencies = {
    createGateway: () => used,
    resolveRuntime: () => runtime(options.json ?? true, options.config ?? {}),
  };

  registerGlobalOptions(command);
  registerExportOptions(command, voucherKind);
  command.parse(['node', voucherKind.shortcut, ...args]);
  await executeExportCommand(command, { voucherKind }, dependencies);

  return used;
}

/** Una factura de servicios a Estados Unidos, con la cotizacion para no depender de la de aduana del dia. */
const BASE = [
  '--cliente',
  'ACME LLC',
  '--domicilio-cliente',
  '123 Main St',
  '--pais-destino',
  '212',
  '-m',
  '1500',
  '--cotizacion-moneda',
  '1000',
];

/** El resumen de A, B y C (docs/input-output.md, "Caso simple") mas `exportacion`. */
const SUMMARY_KEYS = [
  'atajo',
  'avisos',
  'cae',
  'caeVencimiento',
  'comprobante',
  'entorno',
  'errores',
  'estado',
  'eventos',
  'exportacion',
  'numero',
  'observacion',
  'observaciones',
  'previsualizacion',
  'puntoVenta',
  'resultado',
  'solicitud',
  'sugerencias',
  'tipoArca',
];

/** Las claves del bloque `exportacion` del ejemplo de la doc. */
const EXPORT_BLOCK_KEYS = [
  'actividad',
  'cliente',
  'comprobanteAsociado',
  'cuitPaisCliente',
  'destino',
  'domicilioCliente',
  'formaPago',
  'idImpositivo',
  'idioma',
  'incoterm',
  'incotermDescripcion',
  'items',
  'mismaMoneda',
  'permisos',
  'tipoExpo',
  'verificacionPermisos',
];

const keysOf = (value: unknown): string[] => Object.keys(value as Record<string, unknown>).sort();

const originalStdinIsTty = process.stdin.isTTY;
const originalStdoutIsTty = process.stdout.isTTY;

function setTerminal(isTty: boolean): void {
  process.stdin.isTTY = isTty;
  process.stdout.isTTY = isTty;
}

beforeEach(() => {
  stdout = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);

    return true;
  });
  spinner.stop.mockClear();
  vi.mocked(chooseOne).mockReset();
  setTerminal(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  process.stdin.isTTY = originalStdinIsTty;
  process.stdout.isTTY = originalStdoutIsTty;
});

describe('contrato del --json de la E (docs/input-output.md)', () => {
  it('la vista previa trae el resumen de A, B y C mas `exportacion`, con el numero', async () => {
    await run([...BASE, '--previsualizar']);

    const json = JSON.parse(stdout);

    expect(keysOf(json)).toEqual(SUMMARY_KEYS);
    expect(keysOf(json.exportacion)).toEqual(EXPORT_BLOCK_KEYS);
    expect(json).toMatchObject({
      atajo: 'fe',
      cae: null,
      estado: 'previsualizacion',
      exportacion: { comprobanteAsociado: null, destino: { codigo: 212, nombre: 'ESTADOS UNIDOS' } },
      numero: 1,
      previsualizacion: true,
      resultado: null,
      tipoArca: 19,
    });
  });

  it('un comprobante aprobado trae las mismas claves, con el CAE', async () => {
    await run([...BASE, '--emitir']);

    const json = JSON.parse(stdout);

    expect(keysOf(json)).toEqual(SUMMARY_KEYS);
    expect(keysOf(json.exportacion)).toEqual(EXPORT_BLOCK_KEYS);
    expect(json).toMatchObject({
      cae: '75123456789012',
      caeVencimiento: '20261111',
      estado: 'aprobado',
      numero: 1,
      previsualizacion: false,
      resultado: 'A',
    });
  });

  it('en una nota, `exportacion.comprobanteAsociado` trae el asociado con la fecha y el total de ARCA', async () => {
    await run(['-m', '500', '--ar', '1', '--previsualizar'], { voucherKind: EXPORT_CREDIT_NOTE_KIND });

    const json = JSON.parse(stdout);

    expect(keysOf(json)).toEqual(SUMMARY_KEYS);
    expect(json).toMatchObject({ atajo: 'nce', tipoArca: 21 });
    expect(json.exportacion.comprobanteAsociado).toEqual({
      atajo: 'fe',
      fecha: '20261030',
      numero: 1,
      puntoVenta: 4,
      tipoArca: 19,
      total: 1500,
    });
  });

  it('--bruto suma solo `respuesta`: la de WSFEX si se emitio y el mensaje si no', async () => {
    await run([...BASE, '--emitir', '--bruto']);

    const emitted = JSON.parse(stdout);

    expect(keysOf(emitted)).toEqual([...SUMMARY_KEYS, 'respuesta'].sort());
    expect(emitted.respuesta).toMatchObject({ FEXAuthorizeResult: { FEXResultAuth: { Cae: '75123456789012' } } });

    stdout = '';
    await run([...BASE, '--previsualizar', '--bruto']);

    expect(JSON.parse(stdout).respuesta).toEqual({
      mensaje: 'Sin emisión real. Usá `--emitir` para obtener una respuesta de ARCA.',
    });
  });
});

describe('executeExportCommand: la decision de emitir', () => {
  it('con --json y sin flag de emision queda en vista previa y no autoriza', async () => {
    const used = await run(BASE);

    expect(JSON.parse(stdout)).toMatchObject({ estado: 'previsualizacion', previsualizacion: true });
    expect(used.authorize).not.toHaveBeenCalled();
    expect(chooseOne).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('con emitir true en la config emite sin flags', async () => {
    const used = await run(BASE, { config: { output: { emitirPorDefecto: true } } });

    expect(JSON.parse(stdout)).toMatchObject({ cae: '75123456789012', estado: 'aprobado' });
    expect(used.authorize).toHaveBeenCalledTimes(1);
  });

  it('--previsualizar le gana a emitir true en la config', async () => {
    const used = await run([...BASE, '--previsualizar'], { config: { output: { emitirPorDefecto: true } } });

    expect(JSON.parse(stdout)).toMatchObject({ estado: 'previsualizacion' });
    expect(used.authorize).not.toHaveBeenCalled();
  });

  it('sin terminal y sin --json tampoco pregunta ni emite', async () => {
    const used = await run(BASE, { json: false });

    expect(chooseOne).not.toHaveBeenCalled();
    expect(used.authorize).not.toHaveBeenCalled();
  });

  it('en una terminal sin flags pregunta, y si la respuesta es no, no emite', async () => {
    setTerminal(true);
    vi.mocked(chooseOne).mockResolvedValueOnce(false);

    const used = await run(BASE, { json: false });

    expect(chooseOne).toHaveBeenCalledTimes(1);
    expect(used.authorize).not.toHaveBeenCalled();
  });

  // En el asistente Esc vuelve a la ultima pregunta (TUI-15); con flags no hay a donde volver: Esc es no y no emite.
  it('en una terminal, Esc en "¿Emitimos?" cuenta como no emitir', async () => {
    setTerminal(true);
    vi.mocked(chooseOne).mockResolvedValueOnce(false);

    const used = await run(BASE, { json: false });

    expect(vi.mocked(chooseOne).mock.calls[0]?.[3]).toEqual({ escapeLabel: 'no emitir', escapeValue: false });
    expect(used.authorize).not.toHaveBeenCalled();
  });

  it('en una terminal sin flags pregunta, y si la respuesta es si, emite', async () => {
    setTerminal(true);
    vi.mocked(chooseOne).mockResolvedValueOnce('emitir');

    const used = await run(BASE, { json: false });

    expect(used.authorize).toHaveBeenCalledTimes(1);
  });

  it('la confirmación ofrece emitir con PDF, con el cursor ahí si la config dice `siempre`', async () => {
    setTerminal(true);
    vi.mocked(chooseOne).mockResolvedValue(false);

    await run(BASE, { config: { pdf: 'nunca' }, json: false });
    await run(BASE, { config: { pdf: 'siempre' }, json: false });

    const [[, choices, initial], [, , initialWithSiempre]] = vi.mocked(chooseOne).mock.calls;

    expect(choices).toEqual([
      { name: 'Sí, emitir ahora', value: 'emitir' },
      { name: 'Sí, emitir y generar el PDF', value: 'emitir-con-pdf' },
      { name: 'No, dejar sin emitir', value: false },
    ]);
    expect(initial).toBe('emitir');
    expect(initialWithSiempre).toBe('emitir-con-pdf');
  });

  it('con `--sin-pdf` la confirmación solo pregunta si emitir', async () => {
    setTerminal(true);
    vi.mocked(chooseOne).mockResolvedValueOnce(false);

    await run([...BASE, '--sin-pdf'], { config: { pdf: 'siempre' }, json: false });

    expect(vi.mocked(chooseOne).mock.calls[0]?.[1]).toEqual([
      { name: 'Sí, emitir ahora', value: 'emitir' },
      { name: 'No, dejar sin emitir', value: false },
    ]);
  });

  it('en una terminal con --previsualizar no pregunta', async () => {
    setTerminal(true);

    const used = await run([...BASE, '--previsualizar'], { json: false });

    expect(chooseOne).not.toHaveBeenCalled();
    expect(used.authorize).not.toHaveBeenCalled();
  });
});

describe('executeExportCommand: codigo de salida', () => {
  it('rechazado por ARCA: el resultado sale igual, con exit 2', async () => {
    await run([...BASE, '--emitir'], { gateway: gateway({ authorize: vi.fn(async () => authorization('R')) }) });

    expect(JSON.parse(stdout)).toMatchObject({ cae: null, estado: 'rechazado', resultado: 'R' });
    expect(process.exitCode).toBe(2);
  });

  it('aprobado: exit 0', async () => {
    await run([...BASE, '--emitir']);

    expect(process.exitCode).toBeUndefined();
  });

  it('detiene el spinner si la emision falla', async () => {
    const failing = gateway({ authorize: vi.fn(async () => Promise.reject(new Error('socket hang up'))) });

    await expect(run([...BASE, '--emitir'], { gateway: failing, json: false })).rejects.toThrow('socket hang up');
    expect(spinner.stop).toHaveBeenCalled();
  });
});

/** La fecha de la E (#219) con las fechas relativas de #217, como la escribe una persona. */
describe('executeExportCommand: fecha del comprobante (ARCA 1500)', () => {
  /** En pesos, para que la fecha no dependa de la cotizacion de aduana. */
  const IN_PESOS = [...BASE.slice(0, -2), '--moneda', 'PES'];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Miércoles 18/11/2026.
    vi.setSystemTime(new Date('2026-11-18T12:00:00-03:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['-6', '+6'])('`fe --fecha %s` frena antes de ARCA, con el rango que acepta', async (date) => {
    const used = gateway();

    await expect(run([...IN_PESOS, '--fecha', date, '--emitir'], { gateway: used })).rejects.toMatchObject({
      code: 'INPUT_VALIDATION_ERROR',
      message: expect.stringMatching(/del 13\/11\/2026 al 23\/11\/2026.*\(error 1500\)/),
    });
    expect(used.authorize).not.toHaveBeenCalled();
  });

  it('`fe --fecha -5` y `--fecha +5` pasan a la vista previa; la futura avisa del 1535', async () => {
    await run([...IN_PESOS, '--fecha', '-5']);

    expect(JSON.parse(stdout)).toMatchObject({ estado: 'previsualizacion', solicitud: { Fecha_cbte: '20261113' } });

    stdout = '';
    await run([...IN_PESOS, '--fecha', '+5']);

    expect(JSON.parse(stdout)).toMatchObject({
      avisos: expect.arrayContaining([expect.stringContaining('1535')]),
      solicitud: { Fecha_cbte: '20261123' },
    });
  });

  it('en servicios no pasa del fin de mes, aunque esté dentro de los 5 días', async () => {
    vi.setSystemTime(new Date('2026-11-28T12:00:00-03:00'));

    await expect(run([...IN_PESOS, '--fecha', '+3'])).rejects.toMatchObject({
      code: 'INPUT_VALIDATION_ERROR',
      message: expect.stringContaining(
        'al 30/11/2026, hasta 5 días antes o después de hoy y, en servicios, no después del fin de mes (error 1500)',
      ),
    });
  });
});
