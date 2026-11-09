import { describe, expect, it } from 'vitest';

import { stripAnsi } from '../../../ui/primitives';
import { formatExportPayloadTable } from '../export.text';
import { EXPORT_VOUCHER_KIND, type ExportExecutionResult, type ExportVoucherPayload } from '../export.types';

function result(
  payload: Partial<ExportVoucherPayload> = {},
  display: Partial<ExportExecutionResult['display']> = {},
): ExportExecutionResult {
  return {
    display: { countryName: 'ESTADOS UNIDOS', languageName: 'Español', unitNames: { 7: 'unidades' }, ...display },
    dryRun: true,
    environment: 'testing',
    payload: {
      Actividades: { Actividad: [{ Id: 620100 }] },
      CanMisMonExt: 'N',
      Cbte_nro: 2,
      Cbte_Tipo: 19,
      Cliente: 'ACME LLC',
      Cuit_pais_cliente: 55000002126,
      Domicilio_cliente: '123 Main St',
      Dst_cmp: 212,
      Fecha_cbte: '20261030',
      Fecha_pago: '20261030',
      Forma_pago: 'Transferencia Internacional',
      Id: 2,
      Id_impositivo: '',
      Idioma_cbte: 1,
      Imp_total: 1500.5,
      Incoterms: 'FOB',
      Incoterms_Ds: 'FOB',
      Items: { Item: [] },
      Moneda_ctz: 1174.605,
      Moneda_Id: 'DOL',
      Obs: '',
      Obs_comerciales: '',
      Permiso_existente: 'N',
      Punto_vta: 4,
      Tipo_expo: 1,
      ...payload,
    },
    response: {
      cae: null,
      caeVencimiento: null,
      errors: [],
      events: [],
      observacion: null,
      observaciones: [],
      raw: null,
      resultado: null,
      status: 'observado',
      suggestions: [],
    },
    voucherKind: EXPORT_VOUCHER_KIND,
  };
}

const table = (value: ExportExecutionResult) => stripAnsi(formatExportPayloadTable(value));

describe('formatExportPayloadTable', () => {
  it('en una nota muestra el comprobante asociado y no la fecha de pago', () => {
    const invoice = { ...result().payload, CanMisMonExt: undefined, Fecha_pago: undefined };
    const text = table({
      ...result(),
      display: {
        ...result().display,
        associatedVoucher: {
          currencyCode: 'DOL',
          date: '20261030',
          displayName: 'Factura de exportación E',
          total: 1500,
        },
      },
      payload: {
        ...invoice,
        Cbte_Tipo: 21,
        Cmps_asoc: { Cmp_asoc: [{ Cbte_cuit: 20409509763, Cbte_nro: 1, Cbte_punto_vta: 4, Cbte_tipo: 19 }] },
        Permiso_existente: '',
      },
    });

    expect(text).toMatch(/Comprobante asociado\s+Factura de exportación E 00004-00000001 del 30\/10\/2026, 1\.500 USD/);
    expect(text).not.toContain('Fecha de pago');
  });

  it('muestra el importe con el codigo de la moneda, no con el $ de los pesos', () => {
    expect(table(result())).toMatch(/Importe total\s+1\.500,50 USD/);
    expect(table(result({ Moneda_ctz: 1, Moneda_Id: 'PES' }))).toMatch(/Importe total\s+\$ 1\.500,50/);
    expect(table(result())).toMatch(/Moneda\s+Dólares estadounidenses \(USD\), cotización/);
    expect(table(result())).toMatch(/Número\s+\d{5}-\d{8}/);
  });

  it('no repite el incoterm cuando la tabla de ARCA trae el codigo como descripcion', () => {
    expect(table(result())).toMatch(/Incoterm\s+FOB\n/);
    expect(table(result({ Incoterms_Ds: 'Free on Board' }))).toMatch(/Incoterm\s+FOB - Free on Board/);
  });

  it('muestra el idioma con su nombre de la tabla de WSFEX', () => {
    expect(table(result())).toMatch(/Idioma\s+1 - Español/);
    expect(table(result({}, { languageName: undefined }))).toMatch(/Idioma\s+1\n/);
  });
});
