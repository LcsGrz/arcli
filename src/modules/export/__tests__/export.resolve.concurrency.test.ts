import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ExportGateway } from '../export.gateway';
import { EXPORT_CREDIT_NOTE_KIND, EXPORT_DEBIT_NOTE_KIND } from '../export.kinds';
import type { ExportVoucherInput } from '../export.types';

import {
  answer,
  answerAll,
  drive,
  GOODS,
  GOODS_BY_CODE,
  holdGateway,
  newestFirst,
  oldestFirst,
  type Pick,
  type ReadMethod,
  settle,
  startResolve,
} from './export-resolve.fixture';

/** Cuándo arranca cada consulta de la E (ARQ8-6): los países solos, hasta 4 a la vez y nada de más al cortar. */

const NOTE: ExportVoucherInput = {
  amount: 500,
  associatedVoucher: { number: 12 },
  emit: false,
  voucherKind: EXPORT_CREDIT_NOTE_KIND,
};

const FAMILIES: ReadonlyArray<readonly [string, ExportVoucherInput]> = [
  ['factura', GOODS],
  ['nota de crédito con asociado', NOTE],
  ['nota de débito con asociado', { ...NOTE, voucherKind: EXPORT_DEBIT_NOTE_KIND }],
  [
    'nota de débito sin asociado',
    {
      ...GOODS_BY_CODE,
      paymentDate: undefined,
      permits: undefined,
      permitsExisting: undefined,
      voucherKind: EXPORT_DEBIT_NOTE_KIND,
    },
  ],
];

const TABLES: readonly ReadMethod[] = [
  'getDestinationCountryCuits',
  'getUnits',
  'getIncoterms',
  'getLanguages',
  'getCurrencies',
  'getActivities',
];
const NUMBERS: readonly ReadMethod[] = ['getQuotations', 'getLastVoucherNumber', 'getLastRequestId'];

const wsaaError = new Error('ns1:coe.alreadyAuthenticated: El CEE ya posee un TA valido');
const failing = async (): Promise<never> => {
  throw wsaaError;
};

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => {
  unhandled.push(reason);
};

beforeEach(() => {
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
});

/** Arranca la resolución y contesta lo que va antes de las tablas: el asociado, si hay, y los países. */
async function untilTables(input: ExportVoucherInput, overrides: Partial<ExportGateway> = {}) {
  const held = holdGateway(overrides);
  const outcome = startResolve(held, input);

  await settle();

  if (input.associatedVoucher) {
    await answer(held, 'getVoucher');
  }

  await answer(held, 'getDestinationCountries');

  return { held, outcome };
}

describe.each(FAMILIES)('%s', (_name, input) => {
  it.each<[string, Pick]>([
    ['en el orden en que arrancan', oldestFirst],
    ['en el orden inverso', newestFirst],
  ])('nunca más de 4 a la vez, contestando %s', async (_order, pick) => {
    const held = holdGateway();

    expect(await drive(held, input, pick)).toHaveProperty('resolved');
    expect(held.peak()).toBeLessThanOrEqual(4);
  });

  it('los países terminan antes de arrancar otra, y cada consulta va una sola vez', async () => {
    const held = holdGateway();

    await drive(held, input, newestFirst);

    const until = held.events.indexOf('fin getDestinationCountries');

    expect(held.events.slice(0, until).filter((event) => !event.endsWith(' getVoucher'))).toEqual([
      'inicio getDestinationCountries',
    ]);
    expect(held.started()).toEqual([...new Set(held.started())]);
  });

  // Tests primero (ARQ8-6): pasa a it() al implementarlo.
  it.fails('después de los países, 4 tablas a la vez, y al contestar una arranca la que sigue', async () => {
    const { held } = await untilTables(input);

    expect(held.pending.map(({ method }) => method)).toHaveLength(4);

    // La última que arrancó: se usa después que las otras.
    await answer(held, held.pending[3].method);

    expect(held.pending).toHaveLength(4);
    expect(TABLES).toEqual(expect.arrayContaining(held.pending.map(({ method }) => method)));
    expect(held.started()).toEqual([...new Set(held.started())]);
  });
});

describe('lo que se consulta', () => {
  it.each<[string, ExportVoucherInput, Partial<ExportGateway>]>([
    ['con un país que no existe', { ...GOODS, destinationCountry: 'Narnia' }, {}],
    ['si fallan los países', GOODS, { getDestinationCountries: failing }],
  ])('%s, nada más', async (_name, input, overrides) => {
    const held = holdGateway(overrides);

    expect(await drive(held, input, newestFirst)).toHaveProperty('error');
    expect(held.started()).toEqual(['getDestinationCountries']);
  });

  it('con un dato local mal, nada', async () => {
    const held = holdGateway();

    expect(await drive(held, { ...GOODS, pointOfSale: 0 }, newestFirst)).toHaveProperty('error');
    expect(held.started()).toEqual([]);
  });

  it('sin incoterm, en pesos y con los números escritos, solo las tablas que hacen falta', async () => {
    const held = holdGateway();
    const outcome = await drive(
      held,
      {
        ...GOODS_BY_CODE,
        currencyCode: 'PES',
        exportType: 2,
        incoterm: undefined,
        incotermDescription: undefined,
        permits: undefined,
        permitsExisting: undefined,
        requestId: 8,
        voucherNumber: 42,
      },
      newestFirst,
    );

    expect(outcome).toHaveProperty('resolved');
    expect(held.started().toSorted()).toEqual([
      'getActivities',
      'getCurrencies',
      'getDestinationCountries',
      'getDestinationCountryCuits',
      'getLanguages',
      'getUnits',
    ]);
  });

  it('la cotización y los números, recién con la moneda validada; los permisos, al final', async () => {
    const held = holdGateway();

    await drive(held, GOODS, newestFirst);

    const numbersStart = Math.min(...NUMBERS.map((method) => held.events.indexOf(`inicio ${method}`)));

    expect(numbersStart).toBeGreaterThan(held.events.indexOf('fin getCurrencies'));
    expect(held.events.slice(-2)).toEqual(['inicio checkPermit', 'fin checkPermit']);
  });

  it('con una moneda que no está en la tabla, ni cotización ni números', async () => {
    const held = holdGateway({ getCurrencies: async () => [{ code: 'PES', name: 'Pesos Argentinos' }] });

    expect(await drive(held, GOODS, newestFirst)).toHaveProperty('error');
    expect(held.started().filter((method) => NUMBERS.includes(method))).toEqual([]);
  });

  // Tests primero (ARQ8-6): pasa a it() al implementarlo.
  it.fails.each<[string, ExportVoucherInput]>([
    ['sin cotización escrita', GOODS],
    ['con cotización escrita', { ...GOODS, exchangeRate: 900 }],
  ])('la cotización, el último número y el ID de solicitud van a la vez, %s', async (_name, input) => {
    const held = holdGateway();

    // Primero todo lo demás.
    await drive(held, input, (pending) =>
      Math.max(
        0,
        pending.findIndex(({ method }) => !NUMBERS.includes(method)),
      ),
    );

    const at = (edge: 'fin' | 'inicio') => NUMBERS.map((method) => held.events.indexOf(`${edge} ${method}`));

    expect(Math.max(...at('inicio'))).toBeLessThan(Math.min(...at('fin')));
  });
});

describe('al cortar', () => {
  // Tests primero (ARQ8-6): pasa a it() al implementarlo.
  it.fails.each<[string, Partial<ExportGateway>]>([
    ['una tabla que falla', { getDestinationCountryCuits: failing }],
    ['un error de entrada', { getDestinationCountryCuits: async () => [] }],
  ])('con %s no arranca lo que estaba en la cola ni espera lo que está en vuelo', async (_name, overrides) => {
    const { held, outcome } = await untilTables(GOODS, overrides);

    expect(held.pending).toHaveLength(4);
    await answer(held, 'getDestinationCountryCuits');
    expect(outcome()).toHaveProperty('error');

    const started = held.started();

    // Con 6 tablas y 4 a la vez quedan 2 en la cola: a lo sumo una ocupó el lugar de la que contestó.
    expect(started.filter((method) => TABLES.includes(method)).length).toBeLessThanOrEqual(5);

    await answerAll(held);
    expect(held.started()).toEqual(started);
  });

  // Tests primero (ARQ8-6): pasa a it() al implementarlo.
  it.fails('las que fallan antes o después de cortar, sin llegar a usarse, no dan un rechazo sin atender', async () => {
    const { held, outcome } = await untilTables(GOODS, {
      getActivities: failing,
      getCurrencies: failing,
      getDestinationCountryCuits: failing,
      getIncoterms: failing,
      getLanguages: failing,
      getUnits: failing,
    });

    expect(held.pending).toHaveLength(4);

    // Antes: todavía se espera la primera.
    await answer(held, held.pending[3].method);
    expect(outcome()).toBeUndefined();
    await answer(held, 'getDestinationCountryCuits');
    expect(outcome()).toEqual({ error: wsaaError });

    await answerAll(held);
    expect(unhandled).toEqual([]);
  });

  // Tests primero (ARQ8-6): pasa a it() al implementarlo.
  it.fails('tampoco los números, si falla la cotización', async () => {
    const held = holdGateway({ getLastRequestId: failing, getLastVoucherNumber: failing, getQuotations: failing });

    expect(await drive(held, GOODS, oldestFirst)).toEqual({ error: wsaaError });
    expect(held.started()).toEqual(expect.arrayContaining([...NUMBERS]));

    await answerAll(held);
    expect(unhandled).toEqual([]);
    expect(held.started()).not.toContain('checkPermit');
  });
});
