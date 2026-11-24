import { arcliConfigSchema } from '../../config/config.schemas';
import { ExportService } from '../export.service';
import type { ExportGateway, ExportIssuedVoucher, ExportVoucherInput } from '../export.types';

/** Una nota E con su asociado y un WSFEX falso, para mirar la solicitud que sale de una entrada. */

export const NOW = new Date('2026-06-01T15:00:00Z');
export const BRAZIL_CUIT = 50000000059;

/** Una factura E de bienes a Brasil: en bienes ARCA no controla destino, moneda ni cotización contra el asociado. */
const ASSOCIATED: ExportIssuedVoucher = {
  activities: [620100],
  arcaType: 19,
  clientAddress: 'Av. Paulista 1000',
  // No es la que saldría de la tabla, para ver de dónde viene.
  clientCountryCuit: BRAZIL_CUIT,
  clientName: 'São João LTDA',
  clientTaxId: '123456789',
  currencyCode: '060',
  date: '20260520',
  destinationCountry: 203,
  exchangeRate: 1600.5,
  exportType: 1,
  incoterm: 'FOB',
  incotermDescription: 'Puerto de origen',
  language: 1,
  number: 12,
  paymentTerms: 'Transferencia Internacional',
  pointOfSale: 3,
  result: 'A',
  total: 1500,
};

const gateway = {
  getActivities: async () => [{ id: 620100, name: 'SERVICIOS' }],
  getCurrencies: async () => ['DOL', '060', 'PES'].map((code) => ({ code, name: code })),
  getDestinationCountries: async () => [
    { code: 203, name: 'Brasil' },
    { code: 212, name: 'Chile' },
  ],
  getDestinationCountryCuits: async () => [
    { countryName: 'Brasil - Persona Física', cuit: BRAZIL_CUIT },
    { countryName: 'Brasil - Persona Jurídica', cuit: 55000000050 },
    { countryName: 'Chile - Persona Jurídica', cuit: 55000000052 },
  ],
  getIncoterms: async () => [
    { code: 'CIF', name: 'Cost' },
    { code: 'FOB', name: 'Free on Board' },
  ],
  getLanguages: async () => [{ id: 1, name: 'Español' }],
  getLastRequestId: async () => 7,
  getLastVoucherNumber: async () => 4,
  getQuotations: async (date: string) => [
    { code: 'DOL', date, rate: 900.5 },
    { code: '060', date, rate: 1700 },
  ],
  getUnits: async () => [{ id: 7, name: 'Unidad' }],
  getVoucher: async () => ASSOCIATED,
} as unknown as ExportGateway;

export async function resolveExportPayload(input: ExportVoucherInput) {
  const runtime = {
    config: arcliConfigSchema.parse({ puntoVentaPorDefecto: 3 }),
    cuit: 20111111112,
    environment: 'testing' as const,
  };

  return (await new ExportService({ clock: { now: () => NOW } }).resolve(input, gateway, runtime)).payload;
}
