import { describe, expect, it, vi } from 'vitest';

import { fakeExportGateway } from '../../../testing/arca-gateways';
import { arcliConfigSchema } from '../../config/config.schemas';
import { previewExport, type PreviewExportOptions } from '../export.emission';
import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_DEBIT_NOTE_KIND,
  type ExportIssuedVoucher,
  type ExportVoucherInput,
} from '../export.types';

/**
 * REV-53: quien ya leyo el asociado de una nota E (el asistente) se lo pasa a `previewExport`. No se consulta de nuevo y
 * el resultado es el mismo que consultandolo: los defaults, los controles, los avisos y los errores.
 */

const ISSUED: ExportIssuedVoucher = {
  activities: [620100],
  arcaType: 19,
  clientAddress: '123 Main St',
  clientCountryCuit: 55000002126,
  clientName: 'ACME LLC',
  currencyCode: 'DOL',
  date: '20261030',
  destinationCountry: 212,
  exchangeRate: 1174.605,
  exportType: 2,
  language: 1,
  number: 1,
  paymentTerms: 'Transferencia Internacional',
  pointOfSale: 3,
  result: 'A',
  total: 1500,
};

const credit = (overrides: Partial<ExportVoucherInput> = {}): ExportVoucherInput => ({
  amount: 500,
  associatedVoucher: { number: 1, pointOfSale: 3 },
  emit: false,
  voucherKind: EXPORT_CREDIT_NOTE_KIND,
  ...overrides,
});
const debit = (overrides: Partial<ExportVoucherInput> = {}) =>
  credit({ voucherKind: EXPORT_DEBIT_NOTE_KIND, ...overrides });

const withRead = (associated: ExportIssuedVoucher): Partial<PreviewExportOptions> => ({ associated });

async function run(input: ExportVoucherInput, answer: ExportIssuedVoucher | null, read?: ExportIssuedVoucher) {
  const gateway = fakeExportGateway({ getVoucher: vi.fn(async () => answer) });
  const result = await previewExport({
    clock: { now: () => new Date('2026-11-18T15:00:00.000Z') },
    gateway,
    input,
    runtime: {
      config: arcliConfigSchema.parse({ cuit: '20111111112', puntoVentaPorDefecto: 3 }),
      cuit: 20111111112,
      environment: 'testing',
    },
    ...(read ? withRead(read) : {}),
  }).then(
    (preview) => ({ preview }),
    (error: unknown) => ({ error }),
  );

  return { gateway, result };
}

const CASES: ReadonlyArray<
  readonly [
    string,
    {
      readonly associated?: Partial<ExportIssuedVoucher>;
      readonly expected: RegExp;
      readonly input: ExportVoucherInput;
    },
  ]
> = [
  ['la NC toma los defaults del asociado', { expected: /"Moneda_ctz":1174.605.*/, input: credit() }],
  ['la ND toma los defaults del asociado', { expected: /"Moneda_ctz":1174.605.*/, input: debit() }],
  ['la ND en pesos no toma su cotización', { expected: /"Moneda_ctz":1[,}]/, input: debit({ currencyCode: 'PES' }) }],
  ['el tope de la NC', { expected: /no puede superar el total/, input: credit({ amount: 2000 }) }],
  ['la ND no tiene tope', { expected: /"Imp_total":2000/, input: debit({ amount: 2000 }) }],
  [
    'la NC no es anterior al asociado',
    {
      associated: { date: '20261117' },
      expected: /no puede ser anterior/,
      input: credit({ voucherDate: '16/11/2026' }),
    },
  ],
  [
    'la ND no es anterior al asociado',
    {
      associated: { date: '20261117' },
      expected: /no puede ser anterior/,
      input: debit({ voucherDate: '16/11/2026' }),
    },
  ],
  ['el asociado sin aprobar', { associated: { result: 'R' }, expected: /no está autorizada/, input: credit() }],
  ['otra cotización en servicios', { expected: /2053/, input: credit({ exchangeRate: 1300 }) }],
  [
    'otro país en servicios',
    { associated: { destinationCountry: 203 }, expected: /2050/, input: debit({ destinationCountry: '212' }) },
  ],
  ['los avisos, en orden', { expected: /es futura/, input: credit({ voucherDate: '19/11/2026' }) }],
];

const describeResult = (result: { readonly error?: unknown; readonly preview?: unknown }): string =>
  result.error instanceof Error ? result.error.message : JSON.stringify(result.preview);

describe('previewExport con el asociado ya leído', () => {
  it.each(CASES)('consultándolo, %s', async (_name, { associated, expected, input }) => {
    const { gateway, result } = await run(input, { ...ISSUED, ...associated });

    expect(gateway.getVoucher).toHaveBeenCalledTimes(1);
    expect(describeResult(result)).toMatch(expected);
  });

  it.each(CASES)('sin consultarlo, %s', async (_name, { associated, input }) => {
    const voucher = { ...ISSUED, ...associated };
    const queried = await run(input, voucher);
    const { gateway, result } = await run(input, voucher, voucher);

    expect(result).toEqual(queried.result);
    expect(gateway.getVoucher).not.toHaveBeenCalled();
  });

  it.each([
    ['tipo', { arcaType: 20 }],
    ['punto de venta', { pointOfSale: 4 }],
    ['número', { number: 2 }],
  ])('si el leído es de otro %s, se consulta el de la entrada', async (_name, other) => {
    const { gateway, result } = await run(credit(), ISSUED, { ...ISSUED, clientName: 'OTRO', ...other });

    expect(gateway.getVoucher).toHaveBeenCalledWith({ arcaType: 19, number: 1, pointOfSale: 3 });
    expect(describeResult(result)).toContain('ACME LLC');
    expect(describeResult(result)).not.toContain('OTRO');
  });

  it('las demás consultas siguen: tablas y número', async () => {
    const { gateway } = await run(credit(), ISSUED, ISSUED);

    expect(gateway.getDestinationCountries).toHaveBeenCalled();
    expect(gateway.getLastVoucherNumber).toHaveBeenCalled();
  });
});
