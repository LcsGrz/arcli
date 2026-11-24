import { vi } from 'vitest';

import { BillingService } from '../../../modules/billing/billing.service';
import { arcliConfigSchema } from '../../../modules/config/config.schemas';
import type { ExportGateway, ExportIssuedVoucher } from '../../../modules/export/export.types';
import type { IssuedVoucher, VoucherHistoryGateway } from '../../../modules/vouchers/voucher-history';
import { systemClock } from '../../../services/time/system-clock';
import type { CliArcaRuntime } from '../../arca-runtime';
import type { InteractiveSession } from '../session';

/**
 * Datos ficticios de los golden de pantallas y de los tests al azar del asistente (NAV-0): un emisor de prueba, el
 * punto de venta 3, ARCA simulado (historial de A, B y C, cotizacion oficial y WSFEX) y el reloj fijo.
 */

/** 18/11/2026 al mediodia de Buenos Aires: el mismo dia en cualquier huso de CI. */
export const NOW = new Date('2026-11-18T15:00:00Z');
const ISSUER_CUIT = 20111111112;
const POINT_OF_SALE = 3;
/** La cotizacion oficial de ARCA para cualquier moneda (`FEParamGetCotizacion`). */
export const OFFICIAL_RATE = 1450;
/** La cotizacion de aduana de WSFEX del dia, con la que arranca la de la E (NAV-9). */
export const EXPORT_QUOTATION_RATE = 1174.6;

const voucher = (overrides: Partial<IssuedVoucher> & Pick<IssuedVoucher, 'number'>): IssuedVoucher => ({
  cae: '86400940834693',
  concept: 2,
  date: '20261110',
  documentNumber: 0,
  documentTypeCode: 99,
  ivaAmount: 0,
  netAmount: 0,
  total: 0,
  ...overrides,
});

/**
 * Lo emitido en el punto de venta 3, por tipo de ARCA: lo que lista "¿Sobre qué factura?" y "¿Cuál repetimos?".
 * Factura C a consumidor final en pesos y otra en dolares; B a consumidor final; A y FCE A a un CUIT; recibo C.
 */
const ISSUED: Readonly<Record<number, readonly IssuedVoucher[]>> = {
  1: [
    voucher({
      documentNumber: 30709965812,
      documentTypeCode: 80,
      ivaAmount: 210,
      netAmount: 1000,
      number: 8,
      total: 1210,
    }),
  ],
  6: [voucher({ ivaAmount: 21, netAmount: 100, number: 21, total: 121 })],
  11: [
    voucher({ netAmount: 150000, number: 14, total: 150000 }),
    voucher({ currency: 'DOL', exchangeRate: 1400, netAmount: 500, number: 15, sameCurrency: true, total: 500 }),
  ],
  15: [voucher({ netAmount: 2500, number: 4, total: 2500 })],
  201: [
    voucher({
      date: '20261112',
      documentNumber: 30709965812,
      documentTypeCode: 80,
      ivaAmount: 1050000,
      netAmount: 5000000,
      number: 2,
      total: 6050000,
    }),
  ],
};

function historyGateway(issued: Readonly<Record<number, readonly IssuedVoucher[]>>): VoucherHistoryGateway {
  return {
    getLastNumber: async (_pointOfSale, arcaType) =>
      (issued[arcaType ?? 0] ?? []).reduce((max, item) => Math.max(max, item.number), 0),
    getVoucher: async (number, _pointOfSale, arcaType) =>
      (issued[arcaType ?? 0] ?? []).find((item) => item.number === number),
  };
}

/**
 * La sesion de A, B y C: config de prueba sin padron, sin control de FCE y sin PDF, el historial de `ISSUED` y la
 * cotizacion oficial fija. `config` pisa claves de la config (por ejemplo `cbu` o `monedaPorDefecto`).
 */
export function createBillingSession(config: Record<string, unknown> = {}): InteractiveSession {
  return {
    arca: {} as never,
    billingGateway: {
      createVoucher: vi.fn(async () => {
        throw new Error('Los golden de pantallas no emiten.');
      }),
      getNextVoucherNumber: vi.fn(async () => 15),
      getQuotation: vi.fn(async () => OFFICIAL_RATE),
    },
    historyGateway: historyGateway(ISSUED),
    runtime: {
      certificateNotices: [],
      config: arcliConfigSchema.parse({
        consultarPadron: false,
        cuit: String(ISSUER_CUIT),
        pdf: 'nunca',
        puntoVentaPorDefecto: POINT_OF_SALE,
        verificarFce: false,
        ...config,
      }),
      context: { cuit: ISSUER_CUIT },
      cuit: ISSUER_CUIT,
      environment: 'testing',
      outputJson: false,
      outputRaw: false,
      pointOfSale: POINT_OF_SALE,
    } as unknown as CliArcaRuntime,
    service: new BillingService({ clock: systemClock }),
  };
}

/** Una factura E de servicios en dolares, cobrada en dolares: la que ajustan las notas E y la que se repite. */
const EXPORT_SERVICES_INVOICE: ExportIssuedVoucher = {
  activities: [620100],
  arcaType: 19,
  cae: '76443017205075',
  clientAddress: '123 Main St, Miami, FL',
  clientName: 'ACME LLC',
  clientTaxId: '12-3456789',
  currencyCode: 'DOL',
  date: '20261110',
  destinationCountry: 212,
  exchangeRate: 1174.6,
  exportType: 2,
  number: 7,
  paymentTerms: 'Transferencia Internacional',
  pointOfSale: POINT_OF_SALE,
  result: 'A',
  sameCurrency: true,
  total: 1500,
};

/** WSFEX simulado: tablas chicas, la cotizacion de aduana del dia y la factura E 3-7. No emite. */
export function createExportGateway(): ExportGateway {
  return {
    authorize: vi.fn(async (): Promise<never> => {
      throw new Error('Los golden de pantallas no emiten.');
    }),
    checkPermit: async () => 'OK',
    getActivities: async () => [{ id: 620100, name: 'SERVICIOS DE CONSULTORES EN INFORMATICA' }],
    getCurrencies: async () => [{ code: 'DOL', name: 'Dólar Estadounidense' }],
    getDestinationCountries: async () => [
      { code: 200, name: 'ARGENTINA' },
      { code: 203, name: 'BRASIL' },
      { code: 212, name: 'ESTADOS UNIDOS' },
    ],
    // Brasil no tiene CUIT publicado: se pregunta.
    getDestinationCountryCuits: async () => [{ countryName: 'ESTADOS UNIDOS - Persona Jurídica', cuit: 55000002126 }],
    getIncoterms: async () => [
      { code: 'EXW', name: 'EXW' },
      { code: 'FOB', name: 'FOB' },
    ],
    getLanguages: async () => [
      { id: 1, name: 'Español' },
      { id: 2, name: 'Inglés' },
    ],
    getLastRequestId: async () => 40,
    getLastVoucherNumber: vi.fn(async (arcaType: number) => (arcaType === 19 ? 7 : 0)),
    getQuotations: async () => [{ code: 'DOL', date: '20261117', rate: EXPORT_QUOTATION_RATE }],
    getUnits: async () => [
      { id: 1, name: 'kilogramos' },
      { id: 7, name: 'unidades' },
    ],
    getVoucher: vi.fn(async (query: { arcaType: number; number: number; pointOfSale: number }) =>
      query.arcaType === 19 && query.number === 7 && query.pointOfSale === POINT_OF_SALE
        ? EXPORT_SERVICES_INVOICE
        : null,
    ),
  } as unknown as ExportGateway;
}
