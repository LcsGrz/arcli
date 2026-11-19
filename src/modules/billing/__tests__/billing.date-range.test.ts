import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveBillingDateRange } from '../billing.date-range';
import type { BillingCommandInput } from '../billing.schemas';
import { getVoucherKindByShortcut } from '../voucher-kind-map';

const invoiceC = getVoucherKindByShortcut('fc')!;
const fceInvoiceC = getVoucherKindByShortcut('fcec')!;

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

  describe('bordes de fechas (TEST-17)', () => {
    it('`--dia` igual a hoy vence hoy, no el mes que viene', () => {
      expect(resolveBillingDateRange(serviceInput({ dueDay: 20 }), invoiceC, '20261220')).toMatchObject({
        paymentDueDate: '20261220',
      });
      expect(resolveBillingDateRange(serviceInput({ dueDay: 19 }), invoiceC, '20261220')).toMatchObject({
        paymentDueDate: '20270119',
      });
    });

    it('la FCE con fecha futura en el mes siguiente se rechaza (10152)', () => {
      const fce = (billingDate: string, today: string) => () =>
        resolveBillingDateRange(
          serviceInput({ billingDate, concept: 'productos', shortcut: 'fcec' }),
          fceInvoiceC,
          today,
        );

      expect(fce('1/04/2026', '20260331')).toThrow(/cae en otro mes/);
      expect(fce('31/03/2026', '20260330')()).toMatchObject({ billingDate: '20260331' });
    });

    it('fechas sin año cerca del cambio de año: el 2/1 y el 30/12', () => {
      expect(
        resolveBillingDateRange(
          serviceInput({ serviceEndDate: '2/1', serviceStartDate: '30/12' }),
          invoiceC,
          '20270102',
        ),
      ).toMatchObject({ billingDate: '20270102', serviceEndDate: '20270102', serviceStartDate: '20261230' });
      expect(
        resolveBillingDateRange(serviceInput({ billingDate: '2/1', paymentDueDate: '2/1' }), invoiceC, '20261230'),
      ).toMatchObject({ billingDate: '20270102', paymentDueDate: '20270102' });
    });

    it('el año de una fecha sin año sale del mes de `today`, no de uno corrido', () => {
      // El 1/7 el 1/1 más cercano es el de este año (181 días) y no el que viene (184).
      expect(
        resolveBillingDateRange(serviceInput({ serviceEndDate: '1/7', serviceStartDate: '1/1' }), invoiceC, '20260701'),
      ).toMatchObject({ serviceEndDate: '20260701', serviceStartDate: '20260101' });
    });
  });

  describe('ventana de productos: hasta 5 días antes y 5 después, futura solo en el mes actual', () => {
    const products = (billingDate: string) => serviceInput({ billingDate, concept: 'productos' });
    const resolve = (billingDate: string, today: string) => () =>
      resolveBillingDateRange(products(billingDate), invoiceC, today);

    it.each([
      ['15/03/2026', '20260315'],
      ['5/03/2026', '20260305'],
      ['10/03/2026', '20260310'],
    ])('el 10/03 acepta %s', (billingDate, expected) => {
      expect(resolve(billingDate, '20260310')()).toEqual({ billingDate: expected });
    });

    it('el día 6 ya está fuera, para adelante y para atrás', () => {
      expect(resolve('16/03/2026', '20260310')).toThrow(/hasta 5 días antes y 5 después de hoy/);
      expect(resolve('4/03/2026', '20260310')).toThrow(/hasta 5 días antes y 5 después de hoy/);
    });

    it('dentro de los 5 días pero en el mes siguiente es error; en el anterior, no', () => {
      expect(resolve('2/04/2026', '20260330')).toThrow(/cae en otro mes/);
      expect(resolve('31/03/2026', '20260330')()).toEqual({ billingDate: '20260331' });
      expect(resolve('28/02/2026', '20260302')()).toEqual({ billingDate: '20260228' });
    });

    it('cuenta los 5 días cruzando un 29/02', () => {
      expect(resolve('24/02/2028', '20280229')()).toEqual({ billingDate: '20280224' });
      expect(resolve('23/02/2028', '20280229')).toThrow(/hasta 5 días antes/);
      expect(resolve('25/02/2028', '20280301')()).toEqual({ billingDate: '20280225' });
      expect(resolve('24/02/2028', '20280301')).toThrow(/hasta 5 días antes/);
    });
  });
});
