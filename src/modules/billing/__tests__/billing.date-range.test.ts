import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveBillingDateRange } from '../billing.date-range';
import type { BillingCommandInput } from '../billing.schemas';
import { getVoucherKindByShortcut } from '../voucher-kind-map';

const invoiceC = getVoucherKindByShortcut('fc')!;

function serviceInput(overrides: Partial<BillingCommandInput> = {}): BillingCommandInput {
  return {
    cancellation: false,
    concept: 'servicios',
    currencyCode: 'PES',
    documentType: 'consumidor-final',
    dryRun: true,
    emit: false,
    exchangeRate: 1,
    ivaCondition: 'consumidor-final',
    sameCurrency: false,
    shortcut: 'fc',
    totalAmount: 1000,
    ...overrides,
  };
}

describe('resolveBillingDateRange', () => {
  // El reloj del sistema queda lejos de `today`: si algo lo lee, el resultado cambia de año.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-07-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts `--dia` from `today`, not from the system clock', () => {
    expect(resolveBillingDateRange(serviceInput({ dueDay: 10 }), invoiceC, '20261220')).toMatchObject({
      billingDate: '20261220',
      paymentDueDate: '20270110',
    });
  });

  it('completes dates without a year from `today`', () => {
    expect(
      resolveBillingDateRange(
        serviceInput({
          billingDate: '15/12',
          serviceEndDate: '15/12',
          serviceStartDate: '1/12',
          paymentDueDate: '5/1',
        }),
        invoiceC,
        '20261220',
      ),
    ).toEqual({
      billingDate: '20261215',
      paymentDueDate: '20270105',
      serviceEndDate: '20261215',
      serviceStartDate: '20261201',
    });
  });
});
