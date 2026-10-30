import { describe, expect, it } from 'vitest';

import { EXPORT_VOUCHER_KIND, type ExportExecutionResult } from '../../export/export.types';
import { mapExportResultToPdfData } from '../pdf-data.mapper';
import { resolvePdfIssuer } from '../pdf-issuer';
import { EXPORT_IVA_LEGEND } from '../pdf-legends';

const ISSUER = resolvePdfIssuer(
  {
    cuit: '20123456786',
    emisor: { domicilio: 'Calle 123, CABA', inicioActividades: '20200301', razonSocial: 'Ana Gomez' },
  },
  'e',
);

function createResult(overrides: Partial<ExportExecutionResult['payload']> = {}): ExportExecutionResult {
  return {
    display: {
      countryName: 'ESTADOS UNIDOS',
      currencyName: 'Dólar Estadounidense',
      unitNames: { 7: 'unidades' },
    },
    dryRun: false,
    environment: 'testing',
    payload: {
      Actividades: { Actividad: [{ Id: 620100 }] },
      CanMisMonExt: 'S',
      Cbte_nro: 12,
      Cbte_Tipo: 19,
      Cliente: 'ACME LLC',
      Cuit_pais_cliente: 55000002126,
      Domicilio_cliente: '123 Main St',
      Dst_cmp: 212,
      Fecha_cbte: '20261030',
      Fecha_pago: '20261115',
      Forma_pago: 'Transferencia Internacional',
      Id: 5,
      Id_impositivo: '12-3456789',
      Idioma_cbte: 1,
      Imp_total: 1500,
      Incoterms: '',
      Incoterms_Ds: '',
      Items: {
        Item: [
          {
            Pro_bonificacion: 0,
            Pro_codigo: '001',
            Pro_ds: 'Servicios de consultoría',
            Pro_precio_uni: 1500,
            Pro_qty: 1,
            Pro_total_item: 1500,
            Pro_umed: 7,
          },
        ],
      },
      Moneda_ctz: 1174,
      Moneda_Id: 'DOL',
      Obs: '',
      Obs_comerciales: 'Orden de compra 778',
      Permiso_existente: '',
      Punto_vta: 4,
      Tipo_expo: 2,
      ...overrides,
    },
    response: {
      cae: '76123456789012',
      caeVencimiento: '20261109',
      errors: [],
      events: [],
      observacion: null,
      observaciones: [],
      raw: null,
      resultado: 'A',
      status: 'aprobado',
      suggestions: [],
    },
    voucherKind: EXPORT_VOUCHER_KIND,
  };
}

describe('mapExportResultToPdfData', () => {
  it('completa lo que la plantilla de la E muestra: destino, divisa, pago, incoterm y leyenda de IVA', () => {
    const data = mapExportResultToPdfData(createResult({ Incoterms: 'FOB', Incoterms_Ds: 'FOB' }), ISSUER);

    expect(data).toMatchObject({
      cbteDesde: 12,
      cbteLetra: 'E',
      cbteTipo: 19,
      condicionIvaExportacion: EXPORT_IVA_LEGEND,
      cotizacion: 1174,
      destinoComprobante: 'ESTADOS UNIDOS',
      divisa: 'DOL - Dólar Estadounidense',
      fechaPago: '20261115',
      formaPago: 'Transferencia Internacional',
      importeTotal: 1500,
      incoterms: 'FOB',
      moneda: 'DOL',
      observaciones: 'Orden de compra 778',
      puntoVenta: 4,
      receptor: {
        cuitPais: '55000002126 (ESTADOS UNIDOS)',
        domicilio: '123 Main St',
        idImpositivo: '12-3456789',
        razonSocial: 'ACME LLC',
      },
    });
    expect(data.items).toEqual([
      {
        cantidad: 1,
        codigo: '001',
        descripcion: 'Servicios de consultoría',
        precioUnitario: 1500,
        subtotal: 1500,
        unidadMedida: 'unidades',
      },
    ]);
  });

  it('sin incoterm no lo informa, y suma la descripcion del incoterm cuando agrega algo', () => {
    expect(mapExportResultToPdfData(createResult(), ISSUER).incoterms).toBeUndefined();
    expect(
      mapExportResultToPdfData(createResult({ Incoterms: 'FOB', Incoterms_Ds: 'Free on Board' }), ISSUER).incoterms,
    ).toBe('FOB - Free on Board');
  });

  it('sin el nombre de la moneda la divisa es solo el codigo', () => {
    const result = createResult();

    expect(
      mapExportResultToPdfData({ ...result, display: { ...result.display, currencyName: undefined } }, ISSUER).divisa,
    ).toBe('DOL');
  });
});
