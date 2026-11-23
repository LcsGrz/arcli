import Big from 'big.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { hasAtMostDecimals } from '../../../lib/numbers/argentine-amount';
import { BILLING_IVA_RATES, ivaRateFactor, ivaRateFromId, ivaRateId } from '../arca-codes';
import { resolveTaxAmounts, sumTaxAmounts } from '../billing.amounts';
import type { BillingIvaRate } from '../billing.schemas';
import { VOUCHER_KIND_MAP } from '../voucher-kind-map';

/** Hoy (yyyymmdd): las reglas de los importes no lo usan. */
const TODAY = '20261118';

/** Importes con centavos, de 0,01 a 10.000 millones: el rango donde un double guarda los centavos exactos. */
const amount = fc.integer({ max: 1_000_000_000_000, min: 1 }).map((cents) => new Big(cents).div(100).toNumber());
const optionalAmount = fc.option(amount, { nil: undefined });
const rate = fc.constantFrom(...BILLING_IVA_RATES);
const letterAOrB = fc.constantFrom(VOUCHER_KIND_MAP.fa, VOUCHER_KIND_MAP.fb, VOUCHER_KIND_MAP.ncb, VOUCHER_KIND_MAP.ra);

const sum = (values: readonly number[]) => values.reduce((total, value) => total.plus(value), new Big(0));

describe('resolveTaxAmounts (propiedades)', () => {
  it('con una alícuota: neto + IVA + exento + no gravado = total al centavo (10048), y el IVA cierra con el neto', () => {
    fc.assert(
      fc.property(letterAOrB, amount, optionalAmount, optionalAmount, rate, (kind, total, exempt, untaxed, ivaRate) => {
        fc.pre(sum([exempt ?? 0, untaxed ?? 0]).lte(total));

        const result = resolveTaxAmounts(
          { exemptAmount: exempt, ivaRate, totalAmount: total, untaxedAmount: untaxed },
          kind,
          TODAY,
        );

        expect(sumTaxAmounts(result)).toBe(total);
        expectArcaCompatible(result);
      }),
    );
  });

  it('con varias alícuotas que suman lo gravado: cierra igual y manda un renglón de IVA por tasa', () => {
    const parts = fc.array(fc.record({ amount, rate }), { maxLength: 8, minLength: 1 });

    fc.assert(
      fc.property(letterAOrB, parts, optionalAmount, optionalAmount, (kind, ivaRateAmounts, exempt, untaxed) => {
        const total = sum([...ivaRateAmounts.map((part) => part.amount), exempt ?? 0, untaxed ?? 0]).toNumber();
        const result = resolveTaxAmounts(
          { exemptAmount: exempt, ivaRateAmounts, totalAmount: total, untaxedAmount: untaxed },
          kind,
          TODAY,
        );

        expect(sumTaxAmounts(result)).toBe(total);
        expect(result.iva?.map((item) => item.Id).sort()).toEqual(
          [...new Set(ivaRateAmounts.map((part) => part.rate))].map((value) => ivaRateId(value)).sort(),
        );
        expectArcaCompatible(result);
      }),
    );
  });

  it('si las alícuotas no suman lo gravado, es un error de entrada', () => {
    const parts = fc.array(fc.record({ amount, rate }), { maxLength: 5, minLength: 1 });

    fc.assert(
      fc.property(parts, amount, (ivaRateAmounts, total) => {
        fc.pre(!sum(ivaRateAmounts.map((part) => part.amount)).eq(total));

        expect(() => resolveTaxAmounts({ ivaRateAmounts, totalAmount: total }, VOUCHER_KIND_MAP.fa, TODAY)).toThrow(
          /no coincide con lo gravado/,
        );
      }),
    );
  });

  it('exento + no gravado mayor al total es un error de entrada', () => {
    fc.assert(
      fc.property(amount, amount, amount, (total, exempt, untaxed) => {
        fc.pre(sum([exempt, untaxed]).gt(total));

        expect(() =>
          resolveTaxAmounts(
            { exemptAmount: exempt, totalAmount: total, untaxedAmount: untaxed },
            VOUCHER_KIND_MAP.fb,
            TODAY,
          ),
        ).toThrow(/no puede superar el monto total/);
      }),
    );
  });

  it('en la C todo el total es neto, sin IVA (10071)', () => {
    const letterC = fc.constantFrom(
      VOUCHER_KIND_MAP.fc,
      VOUCHER_KIND_MAP.ncc,
      VOUCHER_KIND_MAP.fcec,
      VOUCHER_KIND_MAP.rc,
    );

    fc.assert(
      fc.property(letterC, amount, (kind, total) => {
        const result = resolveTaxAmounts({ totalAmount: total }, kind, TODAY);

        expect(result).toEqual({ exemptAmount: 0, ivaAmount: 0, netAmount: total, untaxedAmount: 0 });
        expect(sumTaxAmounts(result)).toBe(total);
      }),
    );
  });
});

/** Lo que ARCA controla de los importes de un comprobante A o B. */
function expectArcaCompatible(result: ReturnType<typeof resolveTaxAmounts>): void {
  for (const value of [result.netAmount, result.ivaAmount, result.exemptAmount, result.untaxedAmount]) {
    expect(value).toBeGreaterThanOrEqual(0);
    expect(hasAtMostDecimals(value, 2)).toBe(true);
  }

  if (result.netAmount === 0) {
    expect(result.ivaAmount).toBe(0);

    return;
  }

  // Con neto, el array de IVA va siempre (10070); sus bases suman el neto (10061) y sus importes, el IVA.
  expect(result.iva?.length).toBeGreaterThan(0);
  expect(sum(result.iva?.map((item) => item.BaseImp) ?? []).toNumber()).toBe(result.netAmount);
  expect(sum(result.iva?.map((item) => item.Importe) ?? []).toNumber()).toBe(result.ivaAmount);

  for (const item of result.iva ?? []) {
    const rateValue = ivaRateFactor(ivaRateFromId(item.Id) as BillingIvaRate);

    expect(hasAtMostDecimals(item.BaseImp, 2) && hasAtMostDecimals(item.Importe, 2)).toBe(true);
    expect(item.BaseImp).toBeGreaterThanOrEqual(0);
    expect(item.Importe).toBeGreaterThanOrEqual(0);
    // El IVA de cada renglón es la base por la tasa, con menos de un centavo de diferencia por el redondeo.
    expect(new Big(item.Importe).minus(new Big(item.BaseImp).times(rateValue)).abs().lt(0.01)).toBe(true);
  }
}
