import { formatDateAsArcaDate, parseArgentineDateInputAsArcaDate } from '../../lib/dates/arca-date';

import type { BillingCommandInput } from './billing.schemas';
import { ensureDateOrder, validateConceptDateInputs } from './billing.validation';

export interface BillingDateRange {
  readonly billingDate: string;
  readonly paymentDueDate: string;
  readonly serviceEndDate: string;
  readonly serviceStartDate: string;
}

function resolvePaymentDateFromDueDay(dueDay: number): Date {
  const referenceDate = new Date();
  const paymentDate = new Date(referenceDate);

  if (dueDay < referenceDate.getDate()) {
    paymentDate.setMonth(paymentDate.getMonth() + 1);
  }

  paymentDate.setDate(dueDay);

  return paymentDate;
}

export function resolveBillingDateRange(input: BillingCommandInput): BillingDateRange {
  validateConceptDateInputs(input);
  const billingDate = input.billingDate
    ? parseArgentineDateInputAsArcaDate(input.billingDate)
    : formatDateAsArcaDate(new Date());

  if (input.billingDate) {
    const serviceStartDate = input.serviceStartDate
      ? parseArgentineDateInputAsArcaDate(input.serviceStartDate)
      : billingDate;
    const serviceEndDate = input.serviceEndDate ? parseArgentineDateInputAsArcaDate(input.serviceEndDate) : billingDate;

    ensureDateOrder(serviceStartDate, serviceEndDate);

    return {
      billingDate,
      paymentDueDate: serviceEndDate,
      serviceEndDate,
      serviceStartDate,
    };
  }

  const paymentDate = input.dueDay ? resolvePaymentDateFromDueDay(input.dueDay) : new Date();
  const serviceEndDate = input.serviceEndDate
    ? parseArgentineDateInputAsArcaDate(input.serviceEndDate)
    : formatDateAsArcaDate(paymentDate);
  const serviceStartDate = input.serviceStartDate
    ? parseArgentineDateInputAsArcaDate(input.serviceStartDate)
    : serviceEndDate;

  ensureDateOrder(serviceStartDate, serviceEndDate);

  return {
    billingDate,
    paymentDueDate: serviceEndDate,
    serviceEndDate,
    serviceStartDate,
  };
}
