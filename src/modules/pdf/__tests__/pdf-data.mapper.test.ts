import { describe, expect, it } from 'vitest';

import { billingAnswer } from '../../../testing/arca-answers';
import type { BillingExecutionResult } from '../../billing/billing.types.internal';
import { getVoucherKindByShortcut } from '../../billing/voucher-kind-map';
import type { UnnumberedVoucherRequest } from '../../billing/voucher-request';
import { EXPORT_VOUCHER_KIND, type ExportExecutionResult } from '../../export/export.types';
import { mapBillingResultToPdfData, mapExportResultToPdfData } from '../pdf-data.mapper';
import { resolvePdfIssuer } from '../pdf-issuer';

const ISSUER = resolvePdfIssuer(
  {
    cuit: '20123456786',
    emisor: { domicilio: 'Calle 123, CABA', inicioActividades: '20200301', razonSocial: 'Ana Gomez' },
  },
  'a',
);

function createResult(shortcut: string, payload: Partial<UnnumberedVoucherRequest>): BillingExecutionResult {
  const voucherKind = getVoucherKindByShortcut(shortcut);

  if (!voucherKind) {
    throw new Error(`Atajo desconocido: ${shortcut}`);
  }

  return {
    dryRun: false,
    environment: 'testing',
    payload: {
      CantReg: 1,
      CbteFch: '20261003',
      CbteTipo: voucherKind.arcaType,
      Concepto: 1,
      CondicionIVAReceptorId: 1,
      DocNro: 30712345671,
      DocTipo: 80,
      ImpIVA: 0,
      ImpNeto: 0,
      ImpOpEx: 0,
      ImpTotConc: 0,
      ImpTotal: 0,
      ImpTrib: 0,
      MonCotiz: 1,
      MonId: 'PES',
      PtoVta: 3,
      ...payload,
    },
    response: {
      arcaNumber: 125,
      cae: '76123456789012',
      caeVencimiento: '20261013',
      errors: [],
      events: [],
      observaciones: [],
      observacion: null,
      raw: {
        cae: '76123456789012',
        caeFchVto: '20261013',
        response: { FeDetResp: { FECAEDetResponse: [{ CbteDesde: 125 }] } },
      },
      resultado: 'A',
      suggestions: [],
      status: 'aprobado',
    },
    voucherKind,
  };
}

// Factura A con IVA, exento y no gravado: el total no es el neto gravado.
const FACTURA_A = {
  ImpIVA: 210,
  ImpNeto: 1000,
  ImpOpEx: 100,
  ImpTotConc: 50,
  ImpTotal: 1360,
  Iva: [{ BaseImp: 1000, Id: 5, Importe: 210 }],
} satisfies Partial<UnnumberedVoucherRequest>;

describe('mapBillingResultToPdfData: importes por letra (TEST-18)', () => {
  it('en la A, el neto gravado es ImpNeto, no el total, y exento y no gravado van aparte', () => {
    const data = mapBillingResultToPdfData(createResult('fa', FACTURA_A), ISSUER);

    expect(data.importeNetoGravado).toBe(1000);
    expect(data.importeExento).toBe(100);
    expect(data.importeNetoNoGravado).toBe(50);
    expect(data.importeIva).toBe(210);
    expect(data.importeTotal).toBe(1360);
    expect(data.items).toEqual([
      expect.objectContaining({ alicuotaIva: 21, descripcion: 'Según detalle', subtotal: 1000 }),
      expect.objectContaining({ alicuotaIva: undefined, descripcion: 'Según detalle (exento)', subtotal: 100 }),
      expect.objectContaining({ alicuotaIva: undefined, descripcion: 'Según detalle (no gravado)', subtotal: 50 }),
    ]);
  });

  it('sin exento ni no gravado no manda esos importes ni sus renglones', () => {
    const data = mapBillingResultToPdfData(
      createResult('fa', { ...FACTURA_A, ImpOpEx: 0, ImpTotConc: 0, ImpTotal: 1210 }),
      ISSUER,
    );

    expect(data.importeExento).toBeUndefined();
    expect(data.importeNetoNoGravado).toBeUndefined();
    expect(data.items).toHaveLength(1);
  });

  it('una A sin alícuotas (solo exenta) no repite el total como renglón', () => {
    const data = mapBillingResultToPdfData(createResult('fa', { ImpOpEx: 500, ImpTotal: 500, Iva: undefined }), ISSUER);

    expect(data.items).toEqual([expect.objectContaining({ descripcion: 'Según detalle (exento)', subtotal: 500 })]);
    expect(data.iva).toBeUndefined();
  });

  it('una A sin alícuotas, exento ni no gravado sale con un renglón por el total', () => {
    const data = mapBillingResultToPdfData(createResult('fa', { ImpTotal: 0, Iva: undefined }), ISSUER);

    expect(data.items).toEqual([expect.objectContaining({ descripcion: 'Según detalle', subtotal: 0 })]);
  });

  it('en la C no hay IVA aunque el payload lo traiga: neto gravado = total, un solo renglón', () => {
    const data = mapBillingResultToPdfData(
      createResult('fc', {
        CondicionIVAReceptorId: 5,
        ImpIVA: 210,
        ImpNeto: 1000,
        ImpTotal: 1210,
        Iva: [{ BaseImp: 1000, Id: 5, Importe: 210 }],
      }),
      ISSUER,
    );

    expect(data.importeIva).toBe(0);
    expect(data.iva).toBeUndefined();
    expect(data.importeNetoGravado).toBe(1210);
    expect(data.items).toEqual([expect.objectContaining({ alicuotaIva: undefined, subtotal: 1210 })]);
  });

  it('en la B el subtotal es el total sin tributos', () => {
    const data = mapBillingResultToPdfData(
      createResult('fb', { ImpIVA: 210, ImpNeto: 1000, ImpTotal: 1260, ImpTrib: 50, Iva: FACTURA_A.Iva }),
      ISSUER,
    );

    expect(data.importeNetoGravado).toBe(1210);
  });
});

describe('PDF sin CAE (TEST-18)', () => {
  it('rechaza un comprobante con CAE pero sin vencimiento del CAE', () => {
    const result = createResult('fa', FACTURA_A);

    expect(() =>
      mapBillingResultToPdfData({ ...result, response: { ...result.response, caeVencimiento: null } }, ISSUER),
    ).toThrow(/no informó el vencimiento del CAE.*está emitido/);
  });

  it('con el detalle suelto, sin lista, el número es el que se mandó (ERR-16)', async () => {
    const result = createResult('fa', FACTURA_A);
    const { raw, voucherNumber: arcaNumber } = await billingAnswer({
      cae: '',
      caeFchVto: '',
      response: { FeDetResp: { FECAEDetResponse: { CbteDesde: 1 } } },
    });

    expect(
      mapBillingResultToPdfData(
        { ...result, response: { ...result.response, arcaNumber, raw }, voucherNumber: 77 },
        ISSUER,
      ),
    ).toMatchObject({ cae: result.response.cae, cbteDesde: 77, cbteHasta: 77 });
  });

  it('sin la tabla de unidades, una que no es la de por defecto sale con su código (ARQ-22)', () => {
    const result = createExportResult();
    const [item] = result.payload.Items.Item;
    const unitOf = (Pro_umed: number) =>
      mapExportResultToPdfData(
        { ...result, payload: { ...result.payload, Items: { Item: [{ ...item, Pro_umed }] } } },
        ISSUER,
      ).items?.[0]?.unidadMedida;

    expect([unitOf(7), unitOf(1)]).toEqual(['unidad', '1']);
  });

  it('rechaza una E sin CAE o sin vencimiento del CAE', () => {
    const result = createExportResult();

    expect(() => mapExportResultToPdfData({ ...result, response: { ...result.response, cae: null } }, ISSUER)).toThrow(
      /no tiene CAE/,
    );
    expect(() =>
      mapExportResultToPdfData({ ...result, response: { ...result.response, caeVencimiento: null } }, ISSUER),
    ).toThrow(/no informó el vencimiento del CAE/);
    expect(mapExportResultToPdfData(result, ISSUER).cae).toBe('76123456789012');
  });
});

function createExportResult(): ExportExecutionResult {
  return {
    display: { unitNames: {} },
    dryRun: false,
    environment: 'testing',
    payload: {
      Actividades: { Actividad: [{ Id: 620100 }] },
      CanMisMonExt: 'S',
      Cbte_nro: 12,
      Cbte_Tipo: 19,
      Cliente: 'ACME LLC',
      Domicilio_cliente: '123 Main St',
      Dst_cmp: 212,
      Fecha_cbte: '20261030',
      Fecha_pago: '20261115',
      Forma_pago: 'Transferencia',
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
            Pro_codigo: '',
            Pro_ds: 'Servicios',
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
      Obs_comerciales: '',
      Permiso_existente: '',
      Punto_vta: 4,
      Tipo_expo: 2,
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
