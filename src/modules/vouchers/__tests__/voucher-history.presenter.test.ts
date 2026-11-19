import { describe, expect, it } from 'vitest';

import { stripAnsi } from '../../../ui/primitives';
import { VOUCHER_KIND_MAP } from '../../billing/voucher-kind-map';
import type { IssuedVoucher } from '../voucher-history';
import {
  formatReceiver,
  formatVoucherDetailAsJson,
  formatVoucherDetailAsText,
  formatVoucherListAsJson,
  formatVoucherListAsText,
  formatVoucherNumber,
  formatVoucherPickerRows,
} from '../voucher-history.presenter';

const voucher: IssuedVoucher = {
  cae: '86400940834444',
  caeExpiration: '20261011',
  concept: 2,
  currency: 'PES',
  date: '20261001',
  documentNumber: 0,
  documentTypeCode: 99,
  exchangeRate: 1,
  exemptAmount: 50,
  ivaAmount: 105.05,
  netAmount: 1000.45,
  number: 12,
  result: 'A',
  taxesAmount: 0,
  total: 1180.5,
  untaxedAmount: 25,
};
const base = { environment: 'testing' as const, pointOfSale: 3, voucherKind: VOUCHER_KIND_MAP.fb };

describe('voucher-history.presenter', () => {
  it('alinea las filas del selector al dato mas largo de cada columna', () => {
    const rows = formatVoucherPickerRows(
      3,
      [
        voucher,
        { ...voucher, cae: undefined, documentNumber: 20123456786, documentTypeCode: 80, number: 13, total: 5 },
      ],
      ' · ',
    );

    expect(rows[0]).toMatch(/^00003-00000012 · 01\/10\/2026 · Consumidor final +· +\$ [\d.,]+ · CAE 86400940834444$/);
    // Sin CAE no queda un separador colgando; el receptor y el total quedan alineados con la otra fila.
    expect(rows[1]).toMatch(/^00003-00000013 · 01\/10\/2026 · CUIT 20-12345678-6 · +\$ 5$/);
    expect(rows[0].indexOf(' · CAE')).toBe(rows[1].length);
  });

  it('con un ancho, agranda los separadores para que las filas lo ocupen', () => {
    const [natural] = formatVoucherPickerRows(3, [voucher], ' · ');
    const [wide] = formatVoucherPickerRows(3, [voucher], ' · ', natural.length + 9);

    expect(wide).toHaveLength(natural.length + 9);
    expect(wide).toMatch(
      /^00003-00000012 {2}· {3}01\/10\/2026 {2}· {2}Consumidor final {2}· {2}.+ {2}· {2}CAE 86400940834444$/,
    );
  });

  it('si no entran en el ancho, quedan como estan', () => {
    const [natural] = formatVoucherPickerRows(3, [voucher], ' · ');

    expect(formatVoucherPickerRows(3, [voucher], ' · ', 20)).toEqual([natural]);
  });

  it('formatea numero y receptor', () => {
    expect(formatVoucherNumber(3, 12)).toBe('00003-00000012');
    expect(formatReceiver(voucher)).toBe('Consumidor final');
    expect(formatReceiver({ ...voucher, documentNumber: 30709965812, documentTypeCode: 80 })).toBe(
      'CUIT 30-70996581-2',
    );
    expect(formatReceiver({ ...voucher, documentNumber: 12345678, documentTypeCode: 96 })).toBe('DNI 12.345.678');
  });

  it('lista los comprobantes en texto y avisa si no hay', () => {
    const text = stripAnsi(formatVoucherListAsText({ ...base, vouchers: [voucher] }));

    expect(text).toContain('ÚLTIMAS FACTURAS B · PV 3 · TESTING');
    expect(stripAnsi(formatVoucherListAsText({ ...base, environment: 'produccion', vouchers: [voucher] }))).toContain(
      'ÚLTIMAS FACTURAS B · PV 3 · PRODUCCIÓN',
    );
    expect(text).toContain('00003-00000012  01/10/2026');
    expect(text).toContain('CAE 86400940834444');
    expect(stripAnsi(formatVoucherListAsText({ ...base, vouchers: [] }))).toContain('No hay facturas B emitidas');
  });

  it('serializa la lista en JSON', () => {
    const json = JSON.parse(formatVoucherListAsJson({ ...base, vouchers: [voucher] }));

    expect(json).toMatchObject({
      atajo: 'fb',
      comprobante: 'Factura B',
      entorno: 'testing',
      puntoVenta: 3,
      tipoArca: 6,
    });
    expect(json.comprobantes[0]).toMatchObject({
      cae: '86400940834444',
      fecha: '20261001',
      importes: { exento: 50, iva: 105.05, neto: 1000.45, noGravado: 25, total: 1180.5, tributos: 0 },
      numero: 12,
      resultado: 'A',
    });
  });

  it('muestra el detalle como ticket con el estado', () => {
    const text = stripAnsi(formatVoucherDetailAsText({ ...base, voucher }));

    expect(text).toContain('FACTURA B');
    expect(text).toContain('Importe no gravado');
    expect(text).toContain('Vencimiento CAE');
    expect(text).toContain('APROBADO');
    expect(text).not.toContain('Cotización');
    expect(
      stripAnsi(formatVoucherDetailAsText({ ...base, voucher: { ...voucher, currency: 'DOL', exchangeRate: 1200 } })),
    ).toContain('Cotización');
    expect(
      stripAnsi(formatVoucherDetailAsText({ ...base, voucher: { ...voucher, currency: 'DOL', exchangeRate: 1200.5 } })),
    ).toMatch(/Cotización\s+1\.200,50[\s\S]*Importe total\s+[\d.,]+ USD/);
  });

  it('serializa el detalle en JSON', () => {
    expect(JSON.parse(formatVoucherDetailAsJson({ ...base, voucher }))).toMatchObject({
      atajo: 'fb',
      caeVencimiento: '20261011',
      numero: 12,
      puntoVenta: 3,
    });
  });

  describe('lo que el SDK descartaba (SDK-13)', () => {
    const note: IssuedVoucher = {
      ...voucher,
      associatedPeriod: { from: '20260901', to: '20260930' },
      associatedVouchers: [{ arcaType: 201, cuit: '20111111112', date: '20260920', number: 7, pointOfSale: 3 }],
      currency: 'DOL',
      exchangeRate: 1452.5,
      ivaAliquots: [
        { amount: 21, base: 100, id: 5 },
        { amount: 10.5, base: 100, id: 4 },
      ],
      observations: ['El credito fiscal discriminado sera de uso exclusivo del receptor.'],
      optionals: [
        { id: '22', value: 'S' },
        { id: '99', value: 'X' },
      ],
      paymentDueDate: '20261015',
      receiverIvaConditionCode: 1,
      sameCurrency: true,
      serviceFrom: '20260901',
      serviceTo: '20260930',
      taxes: [{ amount: 35, base: 1000, description: 'Percepción IIBB', id: 2, rate: 3.5 }],
      taxesAmount: 35,
    };
    const ncea = { ...base, voucherKind: VOUCHER_KIND_MAP.ncea };

    it('los suma al JSON como campos nuevos, sin tocar los que ya estaban', () => {
      const json = JSON.parse(formatVoucherDetailAsJson({ ...ncea, voucher: note }));

      expect(json).toMatchObject({
        alicuotasIva: [
          { baseImponible: 100, id: 5, importe: 21 },
          { baseImponible: 100, id: 4, importe: 10.5 },
        ],
        comprobantesAsociados: [
          { atajo: 'fcea', cuit: '20111111112', fecha: '20260920', numero: 7, puntoVenta: 3, tipoArca: 201 },
        ],
        condicionIvaReceptor: 1,
        importes: { tributos: 35 },
        mismaMoneda: true,
        observaciones: ['El credito fiscal discriminado sera de uso exclusivo del receptor.'],
        opcionales: [
          { id: '22', valor: 'S' },
          { id: '99', valor: 'X' },
        ],
        periodoAsociado: { desde: '20260901', hasta: '20260930' },
        servicioDesde: '20260901',
        servicioHasta: '20260930',
        tributos: [{ alicuota: 3.5, baseImponible: 1000, descripcion: 'Percepción IIBB', id: 2, importe: 35 }],
        vencimientoPago: '20261015',
      });
    });

    it('sin datos, las listas salen vacias y el resto en null', () => {
      expect(JSON.parse(formatVoucherDetailAsJson({ ...base, voucher }))).toMatchObject({
        alicuotasIva: [],
        comprobantesAsociados: [],
        condicionIvaReceptor: null,
        mismaMoneda: null,
        observaciones: [],
        opcionales: [],
        periodoAsociado: null,
        servicioDesde: null,
        servicioHasta: null,
        tributos: [],
        vencimientoPago: null,
      });
      expect(JSON.parse(formatVoucherListAsJson({ ...base, vouchers: [note] })).comprobantes[0]).toMatchObject({
        comprobantesAsociados: [{ numero: 7 }],
        vencimientoPago: '20261015',
      });
    });

    it('los muestra en el ticket y las observaciones aparte', () => {
      const text = stripAnsi(formatVoucherDetailAsText({ ...ncea, voucher: note }));

      expect(text).toMatch(/IVA receptor\s+Responsable inscripto/);
      expect(text).toMatch(/Pago en la misma moneda\s+Sí/);
      expect(text).toMatch(/IVA 21%\s+21 USD sobre 100 USD/);
      expect(text).toMatch(/IVA 10,5%\s+10,50 USD sobre 100 USD/);
      expect(text).toMatch(/Percepción IIBB\s+35 USD/);
      expect(text).toMatch(/Servicio desde\s+01\/09\/2026/);
      expect(text).toMatch(/Servicio hasta\s+30\/09\/2026/);
      expect(text).toMatch(/Vencimiento del pago\s+15\/10\/2026/);
      expect(text).toMatch(/Comprobante asociado\s+Factura de crédito electrónica A/);
      expect(text).toMatch(/Número asociado\s+00003-00000007/);
      expect(text).toMatch(/CUIT asociado\s+20-11111111-2/);
      expect(text).toMatch(/Fecha asociado\s+20\/09\/2026/);
      expect(text).toMatch(/Período asociado\s+01\/09\/2026 al 30\/09\/2026/);
      expect(text).toMatch(/Anulación\s+Sí/);
      expect(text).toContain('OBSERVACIONES');
      expect(text).toContain('1. El credito fiscal discriminado sera de uso exclusivo del receptor.');
    });

    it('oculta lo que no aporta', () => {
      const text = stripAnsi(
        formatVoucherDetailAsText({
          ...base,
          voucher: {
            ...voucher,
            ivaAliquots: [{ amount: 105.05, base: 1000.45, id: 5 }],
            receiverIvaConditionCode: 5,
            sameCurrency: false,
          },
        }),
      );

      expect(text).toMatch(/Alícuota de IVA\s+21%/);
      expect(text).not.toContain('IVA receptor');
      expect(text).not.toContain('misma moneda');
      expect(text).not.toContain('asociado');
      expect(text).not.toContain('Servicio desde');
      expect(text).not.toContain('Vencimiento del pago');
      expect(text).not.toContain('OBSERVACIONES');
    });
  });
});
