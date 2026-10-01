import { describe, expect, it } from 'vitest';

import { resolveIvaRateLabel, resolveTaxAmounts } from '../billing.amounts';
import { billingIvaRateSchema } from '../billing.schemas';
import { VOUCHER_KIND_MAP } from '../voucher-kind-map';

describe('resolveTaxAmounts', () => {
  it('no discrimina IVA para comprobantes tipo C', () => {
    const result = resolveTaxAmounts({ totalAmount: 121 }, VOUCHER_KIND_MAP.fc);

    expect(result).toEqual({ exemptAmount: 0, ivaAmount: 0, netAmount: 121, untaxedAmount: 0 });
  });

  it('discrimina neto e IVA para Factura B', () => {
    const result = resolveTaxAmounts({ totalAmount: 121 }, VOUCHER_KIND_MAP.fb);

    expect(result.netAmount).toBe(100);
    expect(result.ivaAmount).toBe(21);
    expect(result.iva).toEqual([{ BaseImp: 100, Id: 5, Importe: 21 }]);
  });

  it('redondea sin arrastrar el error de punto flotante de la division', () => {
    const result = resolveTaxAmounts({ totalAmount: 100 }, VOUCHER_KIND_MAP.fb);

    expect(result.netAmount).toBe(82.64);
    expect(result.ivaAmount).toBe(17.36);
    expect(result.netAmount + result.ivaAmount).toBe(100);
  });

  it('discrimina IVA en Factura A', () => {
    const result = resolveTaxAmounts({ totalAmount: 121 }, VOUCHER_KIND_MAP.fa);

    expect(result.ivaAmount).toBe(21);
    expect(result.iva).toEqual([{ BaseImp: 100, Id: 5, Importe: 21 }]);
  });

  it.each([
    ['0', 100, 3, 100, 0],
    ['2.5', 102.5, 9, 100, 2.5],
    ['5', 105, 8, 100, 5],
    ['10.5', 110.5, 4, 100, 10.5],
    ['27', 127, 6, 100, 27],
  ] as const)('usa la alicuota %s%%', (ivaRate, totalAmount, id, netAmount, ivaAmount) => {
    const result = resolveTaxAmounts({ ivaRate, totalAmount }, VOUCHER_KIND_MAP.fa);

    expect(result.iva).toEqual([{ BaseImp: netAmount, Id: id, Importe: ivaAmount }]);
    expect(result.netAmount).toBe(netAmount);
    expect(result.ivaAmount).toBe(ivaAmount);
  });

  it('descuenta exento y no gravado antes de calcular el IVA', () => {
    const result = resolveTaxAmounts({ exemptAmount: 50, totalAmount: 196, untaxedAmount: 25 }, VOUCHER_KIND_MAP.fb);

    expect(result).toEqual({
      exemptAmount: 50,
      iva: [{ BaseImp: 100, Id: 5, Importe: 21 }],
      ivaAmount: 21,
      netAmount: 100,
      untaxedAmount: 25,
    });
    expect(result.untaxedAmount + result.exemptAmount + result.netAmount + result.ivaAmount).toBe(196);
  });

  it('no informa IVA cuando todo el monto es exento', () => {
    const result = resolveTaxAmounts({ exemptAmount: 1000, totalAmount: 1000 }, VOUCHER_KIND_MAP.fb);

    expect(result).toEqual({ exemptAmount: 1000, ivaAmount: 0, netAmount: 0, untaxedAmount: 0 });
  });

  it('rechaza exento mas no gravado por encima del total', () => {
    expect(() =>
      resolveTaxAmounts({ exemptAmount: 600, totalAmount: 1000, untaxedAmount: 500 }, VOUCHER_KIND_MAP.fb),
    ).toThrow(/no puede superar el monto total/);
  });

  it('rechaza alicuota, exento y no gravado en letra C', () => {
    expect(() =>
      resolveTaxAmounts({ exemptAmount: 10, ivaRate: '10.5', totalAmount: 100 }, VOUCHER_KIND_MAP.fc),
    ).toThrow(/Quite --alicuota, --exento/);
  });
});

describe('billingIvaRateSchema', () => {
  it.each([
    ['10,5', '10.5'],
    ['10.5%', '10.5'],
    [' 21 ', '21'],
    [27, '27'],
  ])('normaliza %s', (input, expected) => {
    expect(billingIvaRateSchema.parse(input)).toBe(expected);
  });

  it('rechaza alicuotas que ARCA no admite', () => {
    expect(() => billingIvaRateSchema.parse('19')).toThrow(/0, 2.5, 5, 10.5, 21 o 27/);
  });
});

describe('resolveIvaRateLabel', () => {
  it('traduce el id de ARCA a la tasa', () => {
    expect(resolveIvaRateLabel(4)).toBe('10,5%');
    expect(resolveIvaRateLabel(5)).toBe('21%');
    expect(resolveIvaRateLabel(99)).toBeUndefined();
  });
});
