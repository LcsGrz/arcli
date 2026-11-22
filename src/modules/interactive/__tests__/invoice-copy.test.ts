import { describe, expect, it } from 'vitest';

import { VOUCHER_KIND_MAP } from '../../billing/voucher-kind-map';
import type { IssuedVoucher } from '../../vouchers/voucher-history';
import { copiedReceiverNotice, copyInvoiceAmounts, copyInvoiceReceiver } from '../invoice-copy';

function invoice(overrides: Partial<IssuedVoucher> = {}): IssuedVoucher {
  return {
    date: '20261001',
    documentNumber: 20111111112,
    documentTypeCode: 80,
    ivaAmount: 210,
    netAmount: 1000,
    number: 14,
    total: 1210,
    ...overrides,
  };
}

describe('copyInvoiceAmounts', () => {
  it('copies the rate, exempt and untaxed amounts of an A or B invoice', () => {
    expect(copyInvoiceAmounts(invoice({ exemptAmount: 50, total: 1285, untaxedAmount: 25 }), 'a')).toEqual({
      currencyCode: 'PES',
      exchangeRate: undefined,
      exemptAmount: 50,
      ivaRate: '21',
      limitation: undefined,
      untaxedAmount: 25,
    });
  });

  it('keeps the currency and exchange rate of a foreign currency invoice', () => {
    expect(copyInvoiceAmounts(invoice({ currency: 'DOL', exchangeRate: 1450 }), 'a')).toMatchObject({
      currencyCode: 'DOL',
      exchangeRate: 1450,
    });
  });

  it('says why a multi-rate invoice cannot be reproduced', () => {
    // 21% sobre 1000 y 10,5% sobre 500: el cociente no es ninguna tasa.
    const copy = copyInvoiceAmounts(invoice({ ivaAmount: 262.5, netAmount: 1500, total: 1762.5 }), 'a');

    expect(copy.ivaRate).toBeUndefined();
    expect(copy.limitation).toMatch(/varias/);
  });

  it('says why an invoice with taxes cannot be reproduced', () => {
    expect(copyInvoiceAmounts(invoice({ taxesAmount: 30, total: 1240 }), 'a').limitation).toMatch(/tributos/);
  });

  it('does not copy IVA data for letter C', () => {
    expect(copyInvoiceAmounts(invoice({ ivaAmount: 0, netAmount: 1000, total: 1000 }), 'c')).toMatchObject({
      exemptAmount: undefined,
      ivaRate: undefined,
      limitation: undefined,
    });
  });
});

describe('copyInvoiceReceiver', () => {
  it('copies the CUIT and the concept; the IVA condition is asked later', () => {
    expect(copyInvoiceReceiver(invoice({ concept: 1 }))).toEqual({
      concept: 'productos',
      documentNumber: 20111111112,
      documentType: 'cuit',
      ivaCondition: undefined,
    });
  });

  it('a consumer has no document number and its IVA condition is already known', () => {
    expect(copyInvoiceReceiver(invoice({ concept: 3, documentNumber: 0, documentTypeCode: 99 }))).toEqual({
      concept: 'productos-servicios',
      documentNumber: undefined,
      documentType: 'consumidor-final',
      ivaCondition: 'consumidor-final',
    });
  });

  it('falls back to services when ARCA does not report the concept', () => {
    expect(copyInvoiceReceiver(invoice())?.concept).toBe('servicios');
  });

  it('returns undefined for a document type ARCLI does not handle', () => {
    expect(copyInvoiceReceiver(invoice({ documentTypeCode: 1 }))).toBeUndefined();
  });
});

describe('copiedReceiverNotice', () => {
  it('la A y la FCE a algo que no es CUIT avisan con su error; la B a un DNI no', () => {
    expect(copiedReceiverNotice({ documentType: 'dni' }, VOUCHER_KIND_MAP.fa)).toMatch(/fue a un DNI.*10013/);
    expect(copiedReceiverNotice({ documentType: 'cuil' }, VOUCHER_KIND_MAP.ra)).toMatch(/^El recibo A.*10013/);
    expect(copiedReceiverNotice({ documentType: 'dni' }, VOUCHER_KIND_MAP.fceb)).toMatch(/10015/);
    expect(copiedReceiverNotice({ documentType: 'cuit' }, VOUCHER_KIND_MAP.fa)).toBeUndefined();
    expect(copiedReceiverNotice({ documentType: 'dni' }, VOUCHER_KIND_MAP.fb)).toBeUndefined();
  });
});
