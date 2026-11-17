import { describe, expect, it, vi } from 'vitest';

import { stripAnsi } from '../../../ui/primitives';
import { listRecentExportVouchers } from '../export.history';
import {
  formatExportVoucherDetailAsJson,
  formatExportVoucherDetailAsText,
  formatExportVoucherListAsJson,
  formatExportVoucherListAsText,
} from '../export.history.presenter';
import { EXPORT_CREDIT_NOTE_KIND, EXPORT_VOUCHER_KIND, type ExportIssuedVoucher } from '../export.types';

/** La nota de credito E 4-1 de testing, como la devuelve FEXGetCMP. */
const NOTE: ExportIssuedVoucher = {
  activities: [620100],
  arcaType: 21,
  associatedVoucher: { arcaType: 19, number: 1, pointOfSale: 4 },
  cae: '76453017205075',
  caeExpiration: '20261119',
  clientAddress: '123 Main St, Miami, FL',
  clientCountryCuit: 55000002126,
  clientName: 'ACME LLC',
  clientTaxId: '12-3456789',
  currencyCode: 'DOL',
  date: '20261109',
  destinationCountry: 212,
  exchangeRate: 1174.605,
  exportType: 2,
  number: 1,
  pointOfSale: 4,
  result: 'A',
  total: 500,
};

describe('listRecentExportVouchers', () => {
  it('pide el último de ese tipo y va hacia atrás, sin los que no existen', async () => {
    const getVoucher = vi.fn(async (query: { number: number }) =>
      query.number === 2 ? null : { ...NOTE, number: query.number },
    );
    const gateway = { getLastVoucherNumber: vi.fn(async () => 3), getVoucher };
    const vouchers = await listRecentExportVouchers(gateway, 4, 21, { limit: 5 });

    expect(gateway.getLastVoucherNumber).toHaveBeenCalledWith(21, 4);
    expect(vouchers.map((voucher) => voucher.number)).toEqual([3, 1]);
    expect(getVoucher).toHaveBeenCalledWith({ arcaType: 21, number: 3, pointOfSale: 4 });
  });

  it('sin comprobantes no consulta ninguno', async () => {
    const gateway = { getLastVoucherNumber: vi.fn(async () => 0), getVoucher: vi.fn() };

    await expect(listRecentExportVouchers(gateway, 4, 19)).resolves.toEqual([]);
    expect(gateway.getVoucher).not.toHaveBeenCalled();
  });
});

describe('salida de ultimos y consultar con la E', () => {
  const report = { environment: 'testing' as const, pointOfSale: 4, voucherKind: EXPORT_CREDIT_NOTE_KIND };

  it('el listado muestra número, fecha, cliente, total y CAE', () => {
    const text = stripAnsi(formatExportVoucherListAsText({ ...report, vouchers: [NOTE] }));

    expect(text).toContain('PV 4');
    expect(text).toMatch(/00004-00000001 {2}09\/11\/2026 {2}ACME LLC\s+500 USD {2}CAE 76453017205075/);
  });

  it('sin comprobantes lo dice', () => {
    const text = stripAnsi(
      formatExportVoucherListAsText({ ...report, voucherKind: EXPORT_VOUCHER_KIND, vouchers: [] }),
    );

    expect(text).toContain('No hay facturas de exportación E emitidas en el punto de venta 4.');
  });

  it('el detalle muestra el comprobante asociado', () => {
    const text = stripAnsi(formatExportVoucherDetailAsText({ ...report, voucher: NOTE }));

    expect(text).toMatch(/Comprobante asociado\s+Factura de exportación E 00004-00000001/);
    expect(text).toContain('APROBADO');
  });

  it('el JSON usa las claves de la E', () => {
    expect(JSON.parse(formatExportVoucherDetailAsJson({ ...report, voucher: NOTE }))).toMatchObject({
      atajo: 'nce',
      cae: '76453017205075',
      cliente: 'ACME LLC',
      comprobanteAsociado: { atajo: 'fe', numero: 1, puntoVenta: 4, tipoArca: 19 },
      destino: { codigo: 212 },
      entorno: 'testing',
      moneda: 'DOL',
      numero: 1,
      puntoVenta: 4,
      tipoArca: 21,
      total: 500,
    });
    expect(JSON.parse(formatExportVoucherListAsJson({ ...report, vouchers: [NOTE] })).comprobantes).toHaveLength(1);
  });
});
