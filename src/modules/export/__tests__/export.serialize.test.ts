import type { IFEXAuthorizeOutput } from '@arcasdk/core/lib/application/dto/fex';
import { describe, expect, it } from 'vitest';

import { mapExportResponse } from '../export.response';
import { formatExportResultAsJson, serializeExportResult } from '../export.serialize';
import { EXPORT_VOUCHER_KIND, type ExportExecutionResult, type ExportVoucherPayload } from '../export.types';

function payload(overrides: Partial<ExportVoucherPayload> = {}): ExportVoucherPayload {
  return {
    Actividades: { Actividad: [{ Id: 620900 }] },
    CanMisMonExt: 'N',
    Cbte_nro: 12,
    Cbte_Tipo: 19,
    Cliente: 'ACME LLC',
    Cuit_pais_cliente: 50000000016,
    Domicilio_cliente: 'Av. Paulista 1000',
    Dst_cmp: 203,
    Fecha_cbte: '20260601',
    Fecha_pago: '20260601',
    Forma_pago: 'Transferencia Internacional',
    Id: 8,
    Id_impositivo: '',
    Idioma_cbte: 1,
    Imp_total: 1500,
    Incoterms: 'FOB',
    Incoterms_Ds: 'Free on Board',
    Items: {
      Item: [
        {
          Pro_bonificacion: 0,
          Pro_codigo: '001',
          Pro_ds: 'Servicio de consultoria',
          Pro_precio_uni: 1500,
          Pro_qty: 1,
          Pro_total_item: 1500,
          Pro_umed: 7,
        },
      ],
    },
    Moneda_ctz: 1,
    Moneda_Id: 'PES',
    Obs: '',
    Obs_comerciales: '',
    Permiso_existente: 'N',
    Punto_vta: 3,
    Tipo_expo: 1,
    ...overrides,
  };
}

const AUTHORIZATION: IFEXAuthorizeOutput = {
  FEXAuthorizeResult: {
    FEXErr: { ErrCode: 0, ErrMsg: '' },
    FEXEvents: { EventCode: 0, EventMsg: '' },
    FEXResultAuth: {
      Cae: '75123456789012',
      Cbte_nro: 12,
      Cbte_tipo: 19,
      Cuit: 20111111112,
      Fch_cbte: '20260601',
      Fch_venc_Cae: '20260611',
      Id: 8,
      Motivos_Obs: '',
      Punto_vta: 3,
      Reproceso: 'N',
      Resultado: 'A',
    },
  },
};

function result(overrides: Partial<ExportExecutionResult> = {}): ExportExecutionResult {
  return {
    display: { countryName: 'Brasil', incotermName: 'Free on Board', unitNames: { 7: 'Unidad' } },
    dryRun: false,
    environment: 'testing',
    payload: payload(),
    response: mapExportResponse(AUTHORIZATION),
    voucherKind: EXPORT_VOUCHER_KIND,
    ...overrides,
  };
}

describe('serializeExportResult', () => {
  it('mantiene el resumen de A/B/C y agrega el bloque de exportacion', () => {
    const json = serializeExportResult(result());

    expect(json).toMatchObject({
      atajo: 'fe',
      cae: '75123456789012',
      caeVencimiento: '20260611',
      comprobante: 'Factura de exportacion E',
      estado: 'aprobado',
      exportacion: {
        actividad: [620900],
        cliente: 'ACME LLC',
        cuitPaisCliente: 50000000016,
        destino: { codigo: 203, nombre: 'Brasil' },
        domicilioCliente: 'Av. Paulista 1000',
        formaPago: 'Transferencia Internacional',
        idImpositivo: null,
        idioma: 1,
        incoterm: 'FOB',
        incotermDescripcion: 'Free on Board',
        mismaMoneda: false,
        items: [
          {
            cantidad: 1,
            codigo: '001',
            descripcion: 'Servicio de consultoria',
            precioUnitario: 1500,
            total: 1500,
            unidad: 'Unidad',
            unidadCodigo: 7,
          },
        ],
        permisos: [],
        tipoExpo: 1,
      },
      previsualizacion: false,
      tipoArca: 19,
    });
    expect(json.avisos).toEqual([]);
    expect(json.respuesta).toBeUndefined();
  });

  it('deja el nombre de la unidad en null si la tabla de ARCA no lo trae', () => {
    const json = serializeExportResult(result({ display: { countryName: 'Brasil', unitNames: {} } }));
    const exportacion = json.exportacion as { items: Array<{ unidad: string | null; unidadCodigo: number }> };

    expect(exportacion.items[0]).toMatchObject({ unidad: null, unidadCodigo: 7 });
  });

  it('informa la actividad y si el pago se cancela en la misma moneda', () => {
    const json = serializeExportResult(
      result({
        payload: payload({ Actividades: { Actividad: [{ Id: 620900 }] }, CanMisMonExt: 'S' }),
      }),
    );

    expect(json.exportacion).toMatchObject({ actividad: [620900], mismaMoneda: true });
  });

  it('informa los permisos de embarque cuando el Cmp los lleva', () => {
    const json = serializeExportResult(
      result({
        payload: payload({
          Permiso_existente: 'S',
          Permisos: { Permiso: [{ Dst_merc: 203, Id_permiso: 'P1' }] },
        }),
      }),
    );

    expect(json.exportacion).toMatchObject({ permisos: [{ Dst_merc: 203, Id_permiso: 'P1' }] });
  });

  it('la solicitud es el Cmp de WSFEX, sin traducir', () => {
    const solicitud = payload({ Id: 99 });

    expect(serializeExportResult(result({ payload: solicitud })).solicitud).toBe(solicitud);
  });

  it('la clave pdf solo aparece si se intento generar el PDF', () => {
    expect(serializeExportResult(result())).not.toHaveProperty('pdf');
    expect(
      serializeExportResult(result({ pdf: { path: '/tmp/factura-exportacion-e_0003-00000012.pdf' } })),
    ).toMatchObject({
      pdf: { ruta: '/tmp/factura-exportacion-e_0003-00000012.pdf' },
    });
    expect(
      serializeExportResult(
        result({
          pdf: { error: { code: 'PDF_PLUGIN_MISSING', message: 'Falta el plugin.', suggestion: 'Instalelo.' } },
        }),
      ),
    ).toMatchObject({
      pdf: { error: { codigo: 'PDF_PLUGIN_MISSING', mensaje: 'Falta el plugin.', sugerencia: 'Instalelo.' } },
    });
  });

  it('con --bruto agrega respuesta sin quitar el resumen', () => {
    const json = serializeExportResult(result(), { raw: true });

    expect(json).toMatchObject({ atajo: 'fe', estado: 'aprobado', respuesta: AUTHORIZATION });
  });

  it('en vista previa la respuesta cruda es un mensaje', () => {
    const preview = result({ dryRun: true, response: { ...result().response, cae: null, raw: null } });

    expect(serializeExportResult(preview, { raw: true }).respuesta).toEqual({
      mensaje: 'Sin emision real. Use --emitir para obtener una respuesta de ARCA.',
    });
  });

  it('formatExportResultAsJson devuelve JSON con dos espacios', () => {
    const text = formatExportResultAsJson(result());

    expect(text).toBe(JSON.stringify(serializeExportResult(result()), null, 2));
  });
});
