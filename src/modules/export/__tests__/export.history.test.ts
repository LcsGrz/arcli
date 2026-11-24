import { describe, expect, it, vi } from 'vitest';

import { stripAnsi } from '../../../ui/primitives';
import { listRecentExportVouchers } from '../export.history';
import {
  formatExportVoucherDetailAsText,
  formatExportVoucherListAsText,
  formatExportVoucherPickerRows,
  serializeExportVoucherDetail,
  serializeExportVoucherList,
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
    expect(serializeExportVoucherDetail({ ...report, voucher: NOTE })).toMatchObject({
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
    expect(serializeExportVoucherList({ ...report, vouchers: [NOTE] }).comprobantes).toHaveLength(1);
  });
});

describe('salida de la E con datos que faltan, en pesos o rechazada', () => {
  const report = { environment: 'produccion' as const, pointOfSale: 4, voucherKind: EXPORT_VOUCHER_KIND };
  /** Una factura en pesos, sin asociado, CAE, ID impositivo, CUIT de país ni resultado. */
  const BARE: ExportIssuedVoucher = {
    ...NOTE,
    arcaType: 19,
    associatedVoucher: undefined,
    cae: undefined,
    caeExpiration: undefined,
    clientCountryCuit: undefined,
    clientTaxId: undefined,
    currencyCode: 'PES',
    exchangeRate: 1,
    result: undefined,
  };

  it('el detalle no muestra las filas sin dato, ni cotización en pesos, ni resultado', () => {
    const text = stripAnsi(formatExportVoucherDetailAsText({ ...report, voucher: BARE }));

    expect(text).not.toContain('Comprobante asociado');
    expect(text).not.toContain('ID impositivo');
    expect(text).not.toContain('CUIT del país');
    expect(text).not.toContain('Vencimiento CAE');
    expect(text).not.toContain('cotización');
    expect(text).toMatch(/CAE\s+sin CAE/);
    expect(text).not.toContain('N/D');
    expect(text).not.toContain('APROBADO');
    expect(text).not.toContain('RECHAZADO');
  });

  it('el detalle de una moneda extranjera muestra la cotización, y el CUIT del país con guiones', () => {
    const text = stripAnsi(formatExportVoucherDetailAsText({ ...report, voucher: NOTE }));

    expect(text.replace(/[│\s]+/g, ' ')).toMatch(/cotización 1\.174,605/);
    expect(text).toMatch(/CUIT del país del cliente\s+55-00000212-6/);
    expect(text).toMatch(/Vencimiento CAE\s+19\/11\/2026/);
  });

  it('una rechazada lo dice al pie', () => {
    expect(stripAnsi(formatExportVoucherDetailAsText({ ...report, voucher: { ...BARE, result: 'R' } }))).toContain(
      'RECHAZADO',
    );
  });

  it('un asociado de un tipo que no es E se nombra por su tipo de ARCA', () => {
    const voucher = { ...NOTE, associatedVoucher: { arcaType: 1, number: 7, pointOfSale: 2 } };

    expect(stripAnsi(formatExportVoucherDetailAsText({ ...report, voucher }))).toMatch(
      /Comprobante asociado\s+Tipo 1 00002-00000007/,
    );
    expect(serializeExportVoucherDetail({ ...report, voucher }).comprobanteAsociado).toEqual({
      atajo: null,
      numero: 7,
      puntoVenta: 2,
      tipoArca: 1,
    });
  });

  it('el listado deja el CAE vacio si no lo tiene', () => {
    const text = stripAnsi(formatExportVoucherListAsText({ ...report, vouchers: [BARE] }));

    expect(text).toMatch(/00004-00000001 {2}09\/11\/2026 {2}ACME LLC\s+\$ 500\s*$/m);
    expect(text).not.toContain('CAE');
    expect(text).toContain('PRODUCCIÓN');
  });

  it('el JSON pone null en lo que falta, sin sacar claves', () => {
    const json = serializeExportVoucherDetail({ ...report, voucher: BARE });

    expect(json).toMatchObject({
      cae: null,
      caeVencimiento: null,
      comprobanteAsociado: null,
      cuitPaisCliente: null,
      entorno: 'produccion',
      idImpositivo: null,
      resultado: null,
    });
    expect(serializeExportVoucherList({ ...report, vouchers: [] })).toEqual({
      atajo: 'fe',
      comprobante: 'Factura de exportación E',
      comprobantes: [],
      entorno: 'produccion',
      puntoVenta: 4,
      tipoArca: 19,
    });
  });

  it('las filas del selector del asistente llevan número, fecha, cliente, total y CAE si lo tiene', () => {
    const rows = formatExportVoucherPickerRows([NOTE, BARE], ' · ').map(stripAnsi);

    expect(rows[0]).toMatch(/00004-00000001.*09\/11\/2026.*ACME LLC.*500 USD.*CAE 76453017205075/);
    expect(rows[1]).not.toContain('CAE');
  });
});
