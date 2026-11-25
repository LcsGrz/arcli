import { vi } from 'vitest';

import type { BillingGateway } from '../modules/billing/billing.types.internal';
import type { ExportGateway } from '../modules/export/export.gateway';

const refuseToEmit = async (): Promise<never> => {
  throw new Error('Este test no emite: pasá la llamada que emite con `billingAnswer` o `exportAnswer`.');
};

/** Un gateway de A, B y C falso. El test que emite pasa su `createVoucher`. */
export function fakeBillingGateway(overrides: Partial<BillingGateway> = {}): BillingGateway {
  return {
    createVoucher: vi.fn(refuseToEmit),
    getNextVoucherNumber: vi.fn(async () => 42),
    getQuotation: vi.fn(async () => 1000),
    ...overrides,
  };
}

/** Lo mismo, para la E, con tablas chicas de WSFEX. El test que emite pasa su `authorize`. */
export function fakeExportGateway(overrides: Partial<ExportGateway> = {}): ExportGateway {
  return {
    authorize: vi.fn(refuseToEmit),
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
    getVoucher: vi.fn(async () => null),
    ...overrides,
  };
}
