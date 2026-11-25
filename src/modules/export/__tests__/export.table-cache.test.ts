import { describe, expect, it, vi } from 'vitest';

import { fakeExportGateway } from '../../../testing/arca-gateways';
import type { ExportGateway } from '../export.gateway';
import { cacheExportTables } from '../export.table-cache';

const TABLES = [
  'getActivities',
  'getCurrencies',
  'getDestinationCountries',
  'getDestinationCountryCuits',
  'getIncoterms',
  'getLanguages',
  'getUnits',
] as const satisfies ReadonlyArray<keyof ExportGateway>;

const PASSED: ReadonlyArray<readonly [keyof ExportGateway, readonly unknown[]]> = [
  ['authorize', [{ Cbte_nro: 42 }]],
  ['checkPermit', ['26001EC01000123A', 202]],
  ['getLastRequestId', []],
  ['getLastVoucherNumber', [19, 3, 'emitir']],
  ['getQuotations', ['20260529']],
  ['getVoucher', [{ arcaType: 19, number: 7, pointOfSale: 3 }]],
];

const call = (gateway: ExportGateway, method: keyof ExportGateway, args: readonly unknown[]) =>
  (gateway[method] as (...values: readonly unknown[]) => Promise<unknown>)(...args);

it('cada llamada del gateway se recuerda o pasa tal cual, y ninguna falta', () => {
  expect(Object.keys(cacheExportTables(fakeExportGateway())).toSorted()).toEqual(
    [...TABLES, ...PASSED.map(([method]) => method)].toSorted(),
  );
});

describe.each(TABLES)('%s', (method) => {
  it('se consulta una vez: los pedidos simultáneos la comparten y los siguientes toman su respuesta', async () => {
    const gateway = fakeExportGateway();
    const cached = cacheExportTables(gateway);
    const [first, second] = await Promise.all([cached[method](), cached[method]()]);

    expect(second).toBe(first);
    expect(await cached[method]()).toBe(first);
    expect(gateway[method]).toHaveBeenCalledTimes(1);
  });

  it('un error no se guarda: lo reciben los pedidos simultáneos y el siguiente vuelve a consultar', async () => {
    const error = new Error('socket hang up');
    const query = vi.fn().mockRejectedValueOnce(error).mockResolvedValue([]);
    const cached = cacheExportTables(fakeExportGateway({ [method]: query }));

    expect(await Promise.allSettled([cached[method](), cached[method]()])).toEqual([
      { reason: error, status: 'rejected' },
      { reason: error, status: 'rejected' },
    ]);
    expect(await cached[method]()).toEqual([]);
    expect(await cached[method]()).toEqual([]);
    expect(query).toHaveBeenCalledTimes(2);
  });
});

it('otro caché vuelve a consultar', async () => {
  const gateway = fakeExportGateway();

  await cacheExportTables(gateway).getUnits();
  await cacheExportTables(gateway).getUnits();
  expect(gateway.getUnits).toHaveBeenCalledTimes(2);
});

it.each(PASSED)('%s pasa siempre, con sus datos y su respuesta', async (method, args) => {
  const answers = [Promise.resolve('a'), Promise.resolve('b')];
  const query = vi.fn().mockReturnValueOnce(answers[0]).mockReturnValueOnce(answers[1]);
  const cached = cacheExportTables(fakeExportGateway({ [method]: query }));

  expect(await call(cached, method, args)).toBe('a');
  expect(await call(cached, method, args)).toBe('b');
  expect(query.mock.calls).toEqual([args, args]);
});

it('todas las llamadas conservan el `this` del gateway', async () => {
  const methods = [...TABLES, ...PASSED.map(([method]) => method)];
  const seen: unknown[] = [];
  const gateway = Object.fromEntries(
    methods.map((method) => [
      method,
      async function (this: unknown) {
        seen.push(this);
      },
    ]),
  ) as unknown as ExportGateway;
  const cached = cacheExportTables(gateway);

  for (const method of methods) {
    await call(cached, method, []);
  }

  expect(seen).toHaveLength(methods.length);
  expect(seen.every((self) => self === gateway)).toBe(true);
});
