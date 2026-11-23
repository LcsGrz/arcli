import Big from 'big.js';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { resolveRelativeDateInput } from '../../../lib/dates/relative-date';
import { AppError } from '../../../lib/errors/app-error';
import { hasAtMostDecimals } from '../../../lib/numbers/argentine-amount';
import { systemClock } from '../../../services/time/system-clock';
import { arcliConfigSchema } from '../../config/config.schemas';
import { buildExportItems, parseExportItemArgument, sumExportItems } from '../export.items';
import { readExportJsonInput } from '../export.json-input';
import { ExportService } from '../export.service';
import {
  EXPORT_TYPES_WITH_PAYMENT_DATE,
  type ExportGateway,
  type ExportItemInput,
  type ExportType,
  type ExportUnit,
  type ExportVoucherInput,
} from '../export.types';

const UNITS: readonly ExportUnit[] = [
  { id: 1, name: 'Kilogramo' },
  { id: 7, name: 'Unidades' },
];

const RUNTIME = {
  config: arcliConfigSchema.parse({ cuit: '20111111112', puntoVentaPorDefecto: 3 }),
  environment: 'testing' as const,
};

/** WSFEX sin red: tablas chicas, la ultima numeracion y una cotizacion para cualquier dia. */
function createGateway(): ExportGateway {
  return {
    authorize: vi.fn(),
    checkPermit: vi.fn(async () => 'OK'),
    getActivities: vi.fn(async () => []),
    getCurrencies: vi.fn(async () => [{ code: 'DOL', name: 'Dólar Estadounidense' }]),
    getDestinationCountries: vi.fn(async () => [{ code: 203, name: 'Brasil' }]),
    getDestinationCountryCuits: vi.fn(async () => [{ countryName: 'Brasil - Persona Jurídica', cuit: 55000000050 }]),
    getIncoterms: vi.fn(async () => [{ code: 'FOB', name: 'Free on Board' }]),
    getLanguages: vi.fn(async () => [{ id: 1, name: 'Espanol' }]),
    getLastRequestId: vi.fn(async () => 7),
    getLastVoucherNumber: vi.fn(async () => 41),
    getQuotations: vi.fn(async (arcaDate: string) => [{ code: 'DOL', date: arcaDate, rate: 900.5 }]),
    getUnits: vi.fn(async () => [...UNITS]),
    getVoucher: vi.fn(async () => {
      throw new Error('sin asociado en este test');
    }),
  } as unknown as ExportGateway;
}

const instant = fc.date({
  max: new Date('2099-12-31T23:59:59Z'),
  min: new Date('2000-01-01T00:00:00Z'),
  noInvalidDate: true,
});
const decimal = (maxDecimals: number, max: number) =>
  fc.integer({ max: max * 10 ** maxDecimals, min: 1 }).map((units) => new Big(units).div(10 ** maxDecimals).toNumber());
const item: fc.Arbitrary<ExportItemInput> = fc.record({
  description: fc.string({ maxLength: 20, minLength: 1 }).filter((text) => text.trim().length > 0),
  quantity: decimal(6, 10_000),
  unit: fc.constantFrom<number | string>(1, 7, 'unidad', 'kilogramos'),
  unitPrice: decimal(6, 100_000),
});

function isArcaDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) {
    return false;
  }

  const date = new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6))));

  return date.toISOString().slice(0, 10).replace(/-/g, '') === value;
}

function isControlledInputError(error: unknown): boolean {
  return error instanceof AppError && error.code === 'INPUT_VALIDATION_ERROR';
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterAll(() => {
  vi.useRealTimers();
});

describe('items de la E (propiedades)', () => {
  it('cada renglón es cantidad × precio al centavo y el total es la suma de los renglones (1610)', () => {
    fc.assert(
      fc.property(fc.array(item, { maxLength: 6, minLength: 1 }), (items) => {
        const amount = sumExportItems(items);
        const result = buildExportItems(items, amount, UNITS, 'Según detalle');

        expect(result.total).toBe(amount);
        expect(result.items.reduce((sum, row) => sum.plus(row.Pro_total_item), new Big(0)).toNumber()).toBe(amount);

        for (const [index, row] of result.items.entries()) {
          expect(hasAtMostDecimals(row.Pro_total_item, 2)).toBe(true);
          expect(row.Pro_total_item).toBe(
            new Big(items[index].quantity).times(items[index].unitPrice).round(2, Big.roundHalfUp).toNumber(),
          );
        }
      }),
    );
  });

  it('si --monto no es la suma de los ítems, es un error de entrada', () => {
    fc.assert(
      fc.property(fc.array(item, { maxLength: 4, minLength: 1 }), decimal(2, 1_000_000), (items, amount) => {
        fc.pre(amount !== sumExportItems(items));

        expect(() => buildExportItems(items, amount, UNITS, 'Según detalle')).toThrow(/no coincide con `--monto`/);
      }),
    );
  });

  it('parseExportItemArgument lee cualquier texto como un ítem o un error de entrada', () => {
    const itemLike = fc
      .array(fc.oneof(fc.string({ maxLength: 8 }), fc.constantFrom('1', '1,5', '1.000,25', 'unidad', '')), {
        maxLength: 6,
      })
      .map((parts) => parts.join('|'));

    fc.assert(
      fc.property(fc.oneof(fc.string(), itemLike), (raw) => {
        try {
          const parsed = parseExportItemArgument(raw);

          expect(parsed.description.trim()).not.toBe('');
          expect(parsed.quantity).toBeGreaterThan(0);
          expect(parsed.unitPrice).toBeGreaterThan(0);
        } catch (error) {
          expect(isControlledInputError(error)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('readExportJsonInput (propiedades)', () => {
  it('cualquier valor da un comprobante o un error de entrada', () => {
    fc.assert(
      fc.property(fc.oneof(fc.anything({ maxDepth: 2 }), fc.dictionary(fc.string(), fc.jsonValue())), (value) => {
        try {
          readExportJsonInput(value);
        } catch (error) {
          expect(isControlledInputError(error)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('ExportService.resolve (propiedades)', () => {
  const service = new ExportService({ clock: systemClock });
  const exportType = fc.constantFrom<ExportType>(1, 2, 4);

  it('arma un Cmp con fechas AAAAMMDD, Imp_total igual a los ítems y Fecha_pago solo donde va', async () => {
    await fc.assert(
      fc.asyncProperty(
        exportType,
        fc.option(fc.array(item, { maxLength: 4, minLength: 1 }), { nil: undefined }),
        decimal(2, 10_000_000),
        fc.integer({ max: 5, min: -5 }),
        instant,
        async (type, items, rawAmount, dayOffset, now) => {
          vi.setSystemTime(now);

          const amount = items ? sumExportItems(items) : rawAmount;

          // Ítems de centésimos de centavo suman 0: eso es un --monto inválido, otra propiedad.
          fc.pre(amount > 0);
          const input: ExportVoucherInput = {
            amount,
            clientAddress: 'Av. Paulista 1000',
            clientName: 'ACME LLC',
            clientTaxId: '123456789',
            destinationCountry: 'brasil',
            emit: false,
            exportType: type,
            incoterm: type === 1 ? 'fob' : undefined,
            items,
            voucherDate: dayOffset === 0 ? undefined : `${dayOffset > 0 ? '+' : ''}${dayOffset}`,
          };
          let payload;

          try {
            ({ payload } = await service.resolve(
              // Las fechas relativas las resuelve el parser del comando antes de llegar al servicio.
              { ...input, voucherDate: resolveRelativeDateInput(input.voucherDate, 'day', now) },
              createGateway(),
              RUNTIME,
            ));
          } catch (error) {
            // Lo único que puede frenar este comprobante es la ventana de fechas (1500): servicios no pasa del mes.
            expect(isControlledInputError(error)).toBe(true);
            expect((error as Error).message).toMatch(/error 1500/);

            return;
          }

          expect(isArcaDate(payload.Fecha_cbte)).toBe(true);
          expect(payload.Imp_total).toBe(amount);
          expect(hasAtMostDecimals(payload.Imp_total, 2)).toBe(true);
          expect(payload.Items.Item.reduce((sum, row) => sum.plus(row.Pro_total_item), new Big(0)).toNumber()).toBe(
            payload.Imp_total,
          );
          expect(payload.Moneda_ctz).toBeGreaterThan(0);
          expect(payload.Tipo_expo).toBe(type);

          if (EXPORT_TYPES_WITH_PAYMENT_DATE.includes(type)) {
            expect(isArcaDate(payload.Fecha_pago)).toBe(true);
            expect(String(payload.Fecha_pago) >= payload.Fecha_cbte).toBe(true);
          } else {
            expect(payload.Fecha_pago).toBeUndefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Contraejemplo de CI (semilla 1223193937): una moneda que no está en la tabla de WSFEX salía como
  // ARCA_QUOTATION_ERROR (no había cotización de "BRASIL") en vez de error de entrada (REGLAS-19).
  it('una moneda que no está en la tabla de WSFEX es un error de entrada, no de cotización', async () => {
    const now = new Date('2000-01-01T00:00:00Z');

    vi.setSystemTime(now);

    const fields = {
      amount: 1,
      clientAddress: '!',
      clientName: '!',
      currencyCode: 'brasil',
      destinationCountry: 'brasil',
      emit: false,
    };

    await expect(service.resolve(fields, createGateway(), RUNTIME)).rejects.toMatchObject({
      code: 'INPUT_VALIDATION_ERROR',
      message: expect.stringMatching(/La moneda BRASIL no está en la tabla de monedas de ARCA.*1590/),
    });
  });

  it('con datos cualquiera da un Cmp o un error de entrada, nunca una excepción', async () => {
    const noisyText = fc.option(fc.oneof(fc.string({ maxLength: 10 }), fc.constantFrom('brasil', 'FOB', 'USD', '')), {
      nil: undefined,
    });
    const noisyNumber = fc.option(fc.oneof(fc.double(), fc.integer(), fc.constantFrom(0, -1, 1.005, 1e20)), {
      nil: undefined,
    });

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          amount: noisyNumber,
          clientAddress: noisyText,
          clientName: noisyText,
          clientTaxId: noisyText,
          currencyCode: noisyText,
          destinationCountry: noisyText,
          exchangeRate: noisyNumber,
          exportType: fc.option(exportType, { nil: undefined }),
          incoterm: noisyText,
          paymentDate: noisyText,
          pointOfSale: noisyNumber,
          voucherDate: noisyText,
          voucherNumber: noisyNumber,
        }),
        instant,
        async (fields, now) => {
          vi.setSystemTime(now);

          try {
            await service.resolve({ ...fields, emit: false }, createGateway(), RUNTIME);
          } catch (error) {
            expect(isControlledInputError(error)).toBe(true);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
