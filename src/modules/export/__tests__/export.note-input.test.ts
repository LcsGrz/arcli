import { describe, expect, it } from 'vitest';

import { arcliConfigSchema } from '../../config/config.schemas';
import { type ExportInputOptions, resolveExportInput } from '../export.input';
import { ExportService } from '../export.service';
import {
  EXPORT_CREDIT_NOTE_KIND,
  type ExportGateway,
  type ExportIssuedVoucher,
  type ExportVoucherKind,
} from '../export.types';

/** REV-52: la nota E de punta a punta, de los flags y el archivo a la solicitud, con su asociado de ARCA. */

const NOW = new Date('2026-06-01T15:00:00Z');
const BRAZIL_CUIT = 50000000059;

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

type Layer = NonNullable<ExportInputOptions['flags']>;

async function payloadOf(flags: Layer, file: Layer = {}, voucherKind: ExportVoucherKind = EXPORT_CREDIT_NOTE_KIND) {
  const { input } = resolveExportInput({
    file: { montoTotal: 500, ...file },
    flags: { comprobanteAsociado: { numero: 12 }, ...flags },
    now: NOW,
    voucherKind,
  });
  const runtime = {
    config: arcliConfigSchema.parse({ puntoVentaPorDefecto: 3 }),
    cuit: 20111111112,
    environment: 'testing' as const,
  };

  return (await new ExportService({ clock: { now: () => NOW } }).resolve(input, gateway, runtime)).payload;
}

describe('lo que la nota E toma de su asociado', () => {
  it('sin otro dato, todo', async () => {
    expect(await payloadOf({})).toMatchObject({
      Cliente: 'São João LTDA',
      Cuit_pais_cliente: BRAZIL_CUIT,
      Domicilio_cliente: 'Av. Paulista 1000',
      Id_impositivo: '123456789',
      Incoterms: 'FOB',
      Incoterms_Ds: 'Puerto de origen',
      Moneda_Id: '060',
      Moneda_ctz: 1600.5,
    });
  });

  it.each<[string, Layer, Layer]>([
    ['en el flag', { cliente: 'Otro LLC' }, {}],
    ['en el archivo', {}, { cliente: 'Otro LLC' }],
    [
      'en el flag, sobre un archivo con otro',
      { cliente: 'Otro LLC' },
      { cliente: 'Tercero', domicilioCliente: 'Calle 3' },
    ],
  ])('otro cliente %s: pide su domicilio en lugar de informar el del asociado', async (_name, flags, file) => {
    await expect(payloadOf(flags, file)).rejects.toThrow('Falta el domicilio del cliente.');
    // Con su domicilio, el ID impositivo del otro tampoco va.
    expect(await payloadOf({ ...flags, domicilioCliente: 'Calle 1' }, file)).toMatchObject({
      Cliente: 'Otro LLC',
      Domicilio_cliente: 'Calle 1',
      Id_impositivo: '',
    });
  });

  it('el mismo cliente, con otras mayúsculas, tildes y espacios, toma lo suyo', async () => {
    expect(await payloadOf({ cliente: ' SAO  joao ltda' })).toMatchObject({
      Domicilio_cliente: 'Av. Paulista 1000',
      Id_impositivo: '123456789',
    });
  });

  it.each([212, '212', 'Chile', 'CHILE'])('otro país (%j): el CUIT del país sale de la tabla', async (paisDestino) => {
    expect(await payloadOf({ paisDestino })).toMatchObject({
      Cuit_pais_cliente: 55000000052,
      Domicilio_cliente: 'Av. Paulista 1000',
      Dst_cmp: 212,
    });
  });

  it.each([203, '203', 'Brasil', ' brasil '])('el mismo país (%j): el CUIT del asociado', async (paisDestino) => {
    expect(await payloadOf({ paisDestino })).toMatchObject({ Cuit_pais_cliente: BRAZIL_CUIT, Dst_cmp: 203 });
  });

  it('el CUIT del país escrito va siempre', async () => {
    expect(await payloadOf({ cuitPais: 55000000050, paisDestino: 203 })).toMatchObject({
      Cuit_pais_cliente: 55000000050,
    });
  });

  it('otro incoterm no lleva la descripción del asociado; el mismo, sí', async () => {
    expect(await payloadOf({ incoterm: 'CIF' })).toMatchObject({ Incoterms: 'CIF', Incoterms_Ds: 'Cost' });
    expect(await payloadOf({ incoterm: ' fob' })).toMatchObject({ Incoterms_Ds: 'Puerto de origen' });
  });
});

describe('la moneda de la nota E', () => {
  it.each(['EUR', 'eur', '060'])('%s es la del asociado: va su cotización', async (codigoMoneda) => {
    expect(await payloadOf({ codigoMoneda })).toMatchObject({ Moneda_Id: '060', Moneda_ctz: 1600.5 });
  });

  it('y tiene su tope', async () => {
    await expect(payloadOf({ codigoMoneda: 'EUR', montoTotal: 2000 })).rejects.toThrow(/no puede superar el total/);
    // En otra moneda los totales no se comparan.
    expect(await payloadOf({ codigoMoneda: 'USD', montoTotal: 2000 })).toMatchObject({ Imp_total: 2000 });
  });

  it.each([
    ['EUR', 1600.5],
    ['USD', 900.5],
  ])('--moneda %s descarta la cotización de un archivo sin `codigoMoneda`', async (codigoMoneda, rate) => {
    expect(await payloadOf({ codigoMoneda }, { cotizacionMoneda: 1111 })).toMatchObject({ Moneda_ctz: rate });
  });

  it('sin --moneda, o vacía, la cotización del archivo queda', async () => {
    expect(await payloadOf({}, { cotizacionMoneda: 1111 })).toMatchObject({ Moneda_ctz: 1111 });
    expect(
      resolveExportInput({
        file: { cotizacionMoneda: 1111 },
        flags: { codigoMoneda: '' },
        now: NOW,
        voucherKind: EXPORT_CREDIT_NOTE_KIND,
      }).input.exchangeRate,
    ).toBe(1111);
  });

  it('sin asociado (bienes), igual', async () => {
    const own = {
      cliente: 'Otro LLC',
      codigoMoneda: 'USD',
      comprobanteAsociado: undefined,
      domicilioCliente: 'Calle 1',
      paisDestino: 203,
      tipoExpo: 1 as const,
    };

    expect(await payloadOf(own, { cotizacionMoneda: 1111 })).toMatchObject({ Moneda_Id: 'DOL', Moneda_ctz: 900.5 });
  });
});
