import { describe, expect, it } from 'vitest';

import { resolveTaxAmounts } from '../billing.amounts';
import { VOUCHER_KIND_MAP } from '../voucher-kind-map';

describe('resolveTaxAmounts', () => {
  it('no discrimina IVA para comprobantes tipo C', () => {
    const result = resolveTaxAmounts(121, 'consumidor-final', VOUCHER_KIND_MAP.fc);

    expect(result).toEqual({ ivaAmount: 0, netAmount: 121 });
  });

  it('discrimina neto e IVA para Factura B', () => {
    const result = resolveTaxAmounts(121, 'consumidor-final', VOUCHER_KIND_MAP.fb);

    expect(result.netAmount).toBe(100);
    expect(result.ivaAmount).toBe(21);
    expect(result.iva).toEqual([{ BaseImp: 100, Id: 5, Importe: 21 }]);
  });

  it('redondea sin arrastrar el error de punto flotante de la division', () => {
    const result = resolveTaxAmounts(100, 'consumidor-final', VOUCHER_KIND_MAP.fb);

    expect(result.netAmount).toBe(82.64);
    expect(result.ivaAmount).toBe(17.36);
    expect(result.netAmount + result.ivaAmount).toBe(100);
  });

  it('aplica IVA en Factura A solo cuando el receptor es responsable inscripto', () => {
    const withIva = resolveTaxAmounts(121, 'responsable-inscripto', VOUCHER_KIND_MAP.fa);
    const withoutIva = resolveTaxAmounts(121, 'consumidor-final', VOUCHER_KIND_MAP.fa);

    expect(withIva.ivaAmount).toBe(21);
    expect(withoutIva.ivaAmount).toBe(0);
  });
});
