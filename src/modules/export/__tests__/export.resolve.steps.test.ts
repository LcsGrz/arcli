import { describe, expect, it } from 'vitest';

import { fakeExportGateway } from '../../../testing/arca-gateways';
import { arcliConfigSchema } from '../../config/config.schemas';
import type { ExportGateway } from '../export.gateway';
import { EXPORT_CREDIT_NOTE_KIND } from '../export.kinds';
import { ExportService } from '../export.service';
import type { ExportIssuedVoucher, ExportVoucherInput } from '../export.types';

/** Los textos y avisos de cada paso de la resolución (ARQ8-6). */

const INVOICE: ExportVoucherInput = {
  amount: 1500,
  clientAddress: '123 Main St',
  clientCountryCuit: 55000002126,
  clientName: 'ACME LLC',
  currencyCode: 'EUR',
  destinationCountry: '212',
  emit: false,
  exportType: 2,
};
const ASSOCIATED: ExportIssuedVoucher = {
  activities: [620100],
  arcaType: 19,
  clientAddress: '123 Main St',
  clientCountryCuit: 55000002126,
  clientName: 'ACME LLC',
  currencyCode: 'DOL',
  date: '20260520',
  destinationCountry: 212,
  exchangeRate: 900,
  exportType: 2,
  number: 12,
  pointOfSale: 3,
  result: 'A',
  total: 1500,
};
const NOTE: ExportVoucherInput = {
  amount: 100,
  associatedVoucher: { number: 12 },
  emit: false,
  voucherKind: EXPORT_CREDIT_NOTE_KIND,
};
const SAME_CURRENCY = { exportType: 4, sameCurrency: true } as const;

const down = async (): Promise<never> => {
  throw new Error('socket hang up');
};
const euro = (date?: string) => ({
  getQuotations: async () => [
    { code: 'DOL', date, rate: 900 },
    { code: '060', date, rate: 1000 },
  ],
});

function resolve(input: ExportVoucherInput, gateway: Partial<ExportGateway> = {}) {
  return new ExportService({ clock: { now: () => new Date('2026-06-01T15:00:00Z') } }).resolve(
    input,
    fakeExportGateway({
      getCurrencies: async () => [
        { code: 'DOL', name: 'Dólar Estadounidense' },
        { code: '060', name: 'Euro' },
      ],
      getVoucher: async () => ASSOCIATED,
      ...euro('20260531'),
      ...gateway,
    }),
    {
      config: arcliConfigSchema.parse({ cuit: '20111111112', puntoVentaPorDefecto: 3 }),
      cuit: 20111111112,
      environment: 'testing',
    },
  );
}

const CASES = [
  ['en servicios', {}, 'En servicios ARCA exige la cotización de aduana', 'En servicios', 2053],
  [
    'con --misma-moneda',
    SAME_CURRENCY,
    'Con `--misma-moneda` ARCA exige la cotización oficial',
    'Con `--misma-moneda`',
    1604,
  ],
] as const;

describe.each(CASES)('la cotización, %s', (_name, input, exacts, subject, code) => {
  it('la escrita se compara con la de su moneda: si coincide, sin avisos', async () => {
    const { payload, warnings } = await resolve({ ...INVOICE, ...input, exchangeRate: 1000 });

    expect(payload).toMatchObject({ Moneda_ctz: 1000, Moneda_Id: '060' });
    expect(warnings).toEqual([]);
  });

  it.each([
    ['con el día', '20260531', ' del 31/05/2026'],
    ['sin fecha en la oficial', undefined, ''],
  ])('si no coincide frena, %s', async (_day, date, day) => {
    await expect(resolve({ ...INVOICE, ...input, exchangeRate: 900 }, euro(date))).rejects.toThrow(
      `${exacts} de 060 del día hábil anterior, 1.000${day}, y \`--cotizacion-moneda\` es 900: ARCA la rechaza (error ${code}).`,
    );
  });

  it('con la tabla caída avisa el error con el que ARCA la rechaza', async () => {
    const { warnings } = await resolve({ ...INVOICE, ...input, exchangeRate: 900 }, { getQuotations: down });

    expect(warnings).toEqual([
      `No se pudo comparar la cotización con la de ARCA (socket hang up): la rechaza si no es la oficial del día hábil anterior (error ${code}).`,
    ]);
  });

  it.each([
    ['de hoy', undefined, 'la fecha del comprobante'],
    ['futura', '03/06/2026', 'hoy, porque la fecha del comprobante es futura'],
  ])('con fecha %s, la de otro día avisa', async (_day, voucherDate, reference) => {
    const { warnings } = await resolve({ ...INVOICE, ...input, voucherDate }, euro('20260529'));

    expect(warnings?.[0]).toBe(
      `${subject} ARCA exige la cotización de 060 del día hábil anterior a ${reference} (error 2053): se usa la del 29/05/2026 (1.000), la última que publicó hasta el 31/05/2026.`,
    );
  });

  it('sin fecha en la oficial, no avisa', async () => {
    expect((await resolve({ ...INVOICE, ...input }, euro())).warnings).toEqual([]);
  });
});

it('sin fecha en la oficial, en otros avisa que es la de aduana, sin día', async () => {
  const { warnings } = await resolve({ ...INVOICE, exportType: 4 }, euro());

  expect(warnings).toEqual([expect.stringContaining('la de aduana')]);
  expect(warnings?.[0]).not.toContain('no publicó');
});

it('la descripción de un ítem que ARCA no acepta corta en la resolución, sin consultar nada', async () => {
  const gateway = fakeExportGateway();

  await expect(
    resolve({ ...INVOICE, items: [{ description: 'x'.repeat(4001), quantity: 1, unitPrice: 1500 }] }, gateway),
  ).rejects.toMatchObject({ code: 'INPUT_VALIDATION_ERROR' });
  expect(gateway.getDestinationCountries).not.toHaveBeenCalled();
});

it('el nombre de la moneda es el de la moneda del comprobante', async () => {
  expect((await resolve(INVOICE)).display.currencyName).toBe('Euro');
});

describe('"sin validar" es solo lo que se escribió', () => {
  it.each<[string, ExportVoucherInput, Partial<ExportGateway>, string]>([
    ['CUIT de país escrito', INVOICE, { getDestinationCountryCuits: down }, 'el CUIT de país 55000002126 no se pudo'],
    ['CUIT de país del asociado', NOTE, { getDestinationCountryCuits: down }, 'los nombres no se muestran'],
    [
      'moneda por defecto de la factura',
      { ...INVOICE, currencyCode: undefined, exchangeRate: 900 },
      { getCurrencies: down },
      'la moneda DOL va sin validar',
    ],
    ['moneda del asociado', NOTE, { getCurrencies: down }, 'los nombres no se muestran'],
  ])('%s', async (_name, input, gateway, text) => {
    expect((await resolve(input, gateway)).warnings).toEqual([expect.stringContaining(text)]);
  });
});
