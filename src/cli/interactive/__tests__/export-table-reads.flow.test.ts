import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../lib/errors/app-error';
import type { ExportGateway } from '../../../modules/export/export.gateway';
import { EXPORT_VOUCHER_KIND } from '../../../modules/export/export.kinds';
import { BACK } from '../../../modules/interactive/wizard';
import { exportAnswer } from '../../../testing/arca-answers';
import { stripAnsi } from '../../../ui';
import { resetEmittedInThisRun } from '../../emitted-vouchers';
import { runExportFlow } from '../export.flow';
import { runExportNoteFlow } from '../export-note.flow';
import { runExportRepeatFlow } from '../export-repeat.flow';
import type { InteractiveSession } from '../session';

import { createBillingSession, createExportGateway, NOW } from './screens.fixtures';
import { createScript, editing, type ScriptedAnswer, singleExportItem } from './script';

/**
 * Cuántas veces consulta el asistente cada cosa de WSFEX en un comprobante E (ARQ8-6): preguntar, vista previa, volver,
 * corregir, otra vista previa y emitir.
 */

let script = createScript([]);
let calls: Array<keyof ExportGateway> = [];
/** Las consultas que fallan la próxima vez. */
let failures = new Map<keyof ExportGateway, Error>();
let output = '';
/** Cuántas llamadas iban en cada "¿Emitimos?". */
let callsAtPreview: number[] = [];

const choose = (...args: Parameters<typeof script.chooseStep>) => {
  if (/Emitimos/.test(args[0])) {
    callsAtPreview.push(calls.length);
  }

  return script.chooseStep(...args);
};

// El WSFEX de abajo de todo: los tests no saben dónde se arma lo que recuerda las tablas.
vi.mock('../../../services/arca/arca-export.gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/arca/arca-export.gateway')>();

  return {
    ArcaExportGateway: class {
      // El de la fábrica trae autenticador; `exportAnswer` usa el verdadero, sin él.
      public constructor(...args: ConstructorParameters<typeof actual.ArcaExportGateway>) {
        return (args[1] ? gateway() : new actual.ArcaExportGateway(...args)) as never;
      }
    },
  };
});

vi.mock('../prompts', () => ({
  askText: async () => '',
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseFromFilterList: (...args: Parameters<typeof script.chooseFromFilterList>) =>
    script.chooseFromFilterList(...args),
  chooseManyStep: (...args: Parameters<typeof script.chooseManyStep>) => script.chooseManyStep(...args),
  chooseOne: (...args: Parameters<typeof script.chooseStep>) => choose(args[0], args[1]),
  chooseOrTypeStep: (...args: Parameters<typeof script.chooseOrTypeStep>) => script.chooseOrTypeStep(...args),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => choose(...args),
  chooseStepWhileLoading: async (
    _message: string,
    _choices: unknown,
    _value: unknown,
    _size: number,
    loading: unknown,
  ) => ({
    loaded: await loading,
  }),
  confirm: (message: string, yesLabel: string, noLabel = 'Cancelar') =>
    choose(message, [
      { name: yesLabel, value: true },
      { name: noLabel, value: false },
    ]),
  editRowsStep: (...args: Parameters<typeof script.editRowsStep>) => script.editRowsStep(...args),
  eraseLastAnswer: () => undefined,
  fitPageSize: () => 12,
  isPromptCancellation: () => false,
}));

vi.mock('../../../modules/config/config.service', () => ({
  ConfigService: class {
    public close() {}
  },
}));

/** El WSFEX de los golden, que además emite, y anota cada llamada. */
function gateway(): ExportGateway {
  const answers: ExportGateway = {
    ...createExportGateway(),
    authorize: async (payload) =>
      exportAnswer({
        FEXAuthorizeResult: {
          FEXErr: { ErrCode: 0, ErrMsg: '' },
          FEXEvents: { EventCode: 0, EventMsg: '' },
          FEXResultAuth: {
            Cae: '75123456789012',
            Cbte_nro: payload.Cbte_nro,
            Cbte_tipo: payload.Cbte_Tipo,
            Cuit: 20111111112,
            Fch_cbte: payload.Fecha_cbte,
            Fch_venc_Cae: '20261130',
            Id: payload.Id,
            Motivos_Obs: '',
            Punto_vta: payload.Punto_vta,
            Reproceso: 'N',
            Resultado: 'A',
          },
        },
      }),
  };

  return Object.fromEntries(
    Object.entries(answers).map(([name, call]) => [
      name,
      async (...args: readonly unknown[]) => {
        const method = name as keyof ExportGateway;
        const error = failures.get(method);

        calls.push(method);

        if (error) {
          failures.delete(method);
          throw error;
        }

        return (call as (...values: readonly unknown[]) => unknown)(...args);
      },
    ]),
  ) as unknown as ExportGateway;
}

const TABLES = [
  'getActivities',
  'getCurrencies',
  'getDestinationCountries',
  'getDestinationCountryCuits',
  'getIncoterms',
  'getLanguages',
  'getUnits',
] as const satisfies ReadonlyArray<keyof ExportGateway>;

const times = (method: keyof ExportGateway, list = calls) => list.filter((name) => name === method).length;

/** Cuántas veces se consultó cada tabla. */
function tableReads(list = calls): Record<string, number> {
  return Object.fromEntries(TABLES.map((method) => [method, times(method, list)]));
}

/** Cada tabla, esas veces; las de `except`, las que digan. */
function eachTable(count: number, except: Partial<Record<(typeof TABLES)[number], number>> = {}) {
  return { ...Object.fromEntries(TABLES.map((method) => [method, count])), ...except };
}

type Steps = ReadonlyArray<readonly [RegExp, ScriptedAnswer]>;

const EMIT = [/Emitimos/, 'Sí, emitir ahora'] as const;
const LANGUAGE = (language: string): Steps => [
  [/Agregamos/, ['Idioma']],
  [/Idioma del comprobante/, language],
];
/** Esc en "¿Emitimos?", otro idioma y, después de la segunda vista previa, emitir. */
const CORRECT_AND_EMIT: Steps = [[/Emitimos/, BACK], ...LANGUAGE('Inglés'), EMIT];

/** Una factura de bienes que pregunta con las siete tablas, hasta la primera vista previa. */
const GOODS: Steps = [
  [/cliente del exterior/, 'ACME LLC'],
  [/Domicilio/, '123 Main St'],
  [/País de destino/, 'ESTADOS UNIDOS'],
  [/ID impositivo/, '12-3456789'],
  [/Qué exportás/, 'Bienes'],
  [/Moneda del comprobante/, 'Dólares'],
  [/Cómo te pagan/, 'En dólares'],
  ...singleExportItem('1.500', 'Vino'),
  [/Incoterm/, 'FOB'],
  [/Permisos de embarque/, ''],
  [/Forma de pago/, ''],
  [/Actividad de WSFEX/, '620100'],
  ...LANGUAGE('Español'),
];
const DO_NOT_SAVE = [/Guardamos la actividad/, 'No'] as const;

const NOTE: Steps = [
  [/Punto de venta de la factura E/, '3'],
  [/Número de la factura E/, '7'],
  [/En qué moneda va la nota/, 'En USD'],
  [/^Ítems de .*: modificá o eliminá ítems/, editing({ edit: ['Según detalle'] })],
  [/Descripción del ítem 1/, ''],
  [/Cantidad/, ''],
  [/Unidad/, 'unidades'],
  [/^(?:Importe|Precio unitario) en USD/, '500'],
  [/Importe total/, 'Confirmar'],
  ...LANGUAGE('Español'),
];

const REPEAT: Steps = [
  [/Cuál repetimos/, '00003-00000007'],
  [/^Ítems de .*: modificá o eliminá ítems/, editing({})],
  [/Importe total/, 'Confirmar'],
  [/Cómo te pagan/, 'En dólares'],
  [/Fecha de pago/, '30/11/2026'],
  ...LANGUAGE('Español'),
];

async function run(steps: Steps, flow: (session: InteractiveSession) => Promise<unknown>): Promise<void> {
  script = createScript(steps);
  // Nombres ficticios: solo dicen que WSFEX usa el certificado de facturación. No se lee ningún archivo.
  await flow(createBillingSession({ cert: { testing: 'cert.pem' }, key: { testing: 'key.pem' } }));
  expect(script.remaining(), 'quedaron respuestas del guion sin preguntar').toBe(0);
}

const creditNote = (session: InteractiveSession) => runExportNoteFlow(session, 'credito', EXPORT_VOUCHER_KIND);
const debitNote = (session: InteractiveSession) => runExportNoteFlow(session, 'debito', EXPORT_VOUCHER_KIND);
const repeat = (session: InteractiveSession) => runExportRepeatFlow(session, 3);

const FLOWS: ReadonlyArray<
  readonly [string, Steps, (session: InteractiveSession) => Promise<unknown>, ReturnType<typeof eachTable>]
> = [
  ['factura', [...GOODS, ...CORRECT_AND_EMIT, DO_NOT_SAVE], runExportFlow, eachTable(1)],
  // Servicios: sin incoterm.
  ['nota de crédito', [...NOTE, ...CORRECT_AND_EMIT], creditNote, eachTable(1, { getIncoterms: 0 })],
  ['nota de débito', [...NOTE, ...CORRECT_AND_EMIT], debitNote, eachTable(1, { getIncoterms: 0 })],
  ['"Repetir"', [...REPEAT, ...CORRECT_AND_EMIT], repeat, eachTable(1, { getIncoterms: 0 })],
];

beforeEach(() => {
  calls = [];
  callsAtPreview = [];
  failures = new Map();
  output = '';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output += stripAnsi(String(chunk));

    return true;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetEmittedInThisRun();
});

describe.each(FLOWS)('%s E: preguntar, vista previa, corregir y emitir', (_name, steps, flow, reads) => {
  // Tests primero (ARQ8-6): pasa a it() al implementarlo.
  it.fails('consulta cada tabla una sola vez', async () => {
    await run(steps, flow);

    expect(tableReads()).toEqual(reads);
  });

  it('los números y la cotización, en cada vista previa; emite una vez, sin volver a consultar', async () => {
    await run(steps, flow);

    const [first, second] = callsAtPreview;
    const corrected = calls.slice(first, second);

    expect(callsAtPreview).toHaveLength(2);
    expect(times('getLastRequestId', calls.slice(0, first))).toBe(1);
    expect([times('getLastRequestId', corrected), times('getLastVoucherNumber', corrected)]).toEqual([1, 1]);
    // La nota toma la cotización de su asociado.
    expect(times('getQuotations', corrected)).toBe(flow === creditNote || flow === debitNote ? 0 : 1);
    expect(calls.slice(second)).toEqual(['authorize']);
  });
});

const tableError = () => new AppError('ARCA devolvió un error', { code: 'ARCA_EXPORT_ERROR' });
/** Sin la pregunta del idioma: lo consulta recién la vista previa. */
const TWO_PREVIEWS: Steps = [
  ...GOODS.slice(0, -2),
  [/Agregamos/, []],
  [/Emitimos/, BACK],
  [/Agregamos/, []],
  EMIT,
  DO_NOT_SAVE,
];

describe('entre comprobantes y con errores', () => {
  // Tests primero (ARQ8-6): pasa a it() al implementarlo.
  it.fails('el comprobante siguiente vuelve a consultar cada tabla, una vez', async () => {
    await run([...GOODS, EMIT, DO_NOT_SAVE], runExportFlow);
    await run([...GOODS, ...CORRECT_AND_EMIT, DO_NOT_SAVE], runExportFlow);

    expect(tableReads()).toEqual(eachTable(2));
  });

  // Tests primero (ARQ8-6): pasa a it() al implementarlo.
  it.fails('una tabla que falló se consulta de nuevo y las demás no', async () => {
    failures.set('getLanguages', tableError());
    await run(TWO_PREVIEWS, runExportFlow);

    expect(output.match(/No se pudo consultar la tabla de idiomas/g)).toHaveLength(1);
    expect(tableReads()).toEqual(eachTable(1, { getLanguages: 2 }));
  });

  it('una tabla que falló en la primera vista previa se lee en la segunda', async () => {
    failures.set('getLanguages', tableError());
    await run(TWO_PREVIEWS, runExportFlow);

    expect(output.match(/tabla de idiomas/g)).toHaveLength(1);
    expect(output).toContain('Español');
  });

  it('las monedas que fallaron al preguntar se consultan de nuevo en la vista previa', async () => {
    failures.set('getCurrencies', tableError());
    await run([...GOODS, EMIT, DO_NOT_SAVE], runExportFlow);

    expect(times('getCurrencies')).toBe(2);
    expect(output).not.toContain('tabla de monedas');
  });
});
