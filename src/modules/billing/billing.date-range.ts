import { formatDateAsArcaDate, maxArcaDate } from '../../lib/dates/arca-date';
import { assertRules } from '../../lib/rules/rules';

import {
  parseBillingDateInput,
  resolveBillingDate,
  resolvePaymentDateFromDueDay,
  shouldSendPaymentDueDate,
} from './billing.dates';
import { isElectronicCreditInvoice } from './billing.fce';
import {
  BILLING_DATE_WINDOW_RULE,
  type BillingRuleContext,
  DUE_DATE_MINIMUM_RULE,
  SERVICE_DATE_ORDER_RULE,
} from './billing.rules';
import type { BillingCommandInput } from './billing.schemas';
import type { VoucherKindDefinition } from './billing.types';
import { validateConceptDateInputs } from './billing.validation';

export interface BillingDateRange {
  readonly billingDate: string;
  readonly paymentDueDate?: string;
  readonly serviceEndDate?: string;
  readonly serviceStartDate?: string;
}

/** `--dia` (y `dia` en el JSON) queda por compatibilidad: es un atajo de `--vto` que se va a sacar. */
export const DUE_DAY_DEPRECATION_WARNING =
  '`--dia` está deprecado y se va a sacar en una próxima versión: usá `--vencimiento` o `--vto` (por ejemplo, `--vto 10`).';

/** El mismo aviso cuando `dia` vino del JSON de `--cargar`: nombra la clave, no el flag. */
export const DUE_DAY_FILE_DEPRECATION_WARNING =
  'La clave "dia" del JSON de `--cargar` está deprecada y se va a sacar en una próxima versión: usá "vencimientoPago" (por ejemplo, `"vencimientoPago": "10"`).';

function resolveServiceDates(
  input: BillingCommandInput,
  billingDate: string,
  context: BillingRuleContext,
): Required<Pick<BillingDateRange, 'serviceEndDate' | 'serviceStartDate'>> {
  assertRules([SERVICE_DATE_ORDER_RULE], input, context);

  const serviceEndDate = input.serviceEndDate
    ? parseBillingDateInput(input.serviceEndDate, context.today)
    : billingDate;
  const serviceStartDate = input.serviceStartDate
    ? parseBillingDateInput(input.serviceStartDate, context.today)
    : serviceEndDate;

  return { serviceEndDate, serviceStartDate };
}

export function resolveBillingDateRange(
  input: BillingCommandInput,
  voucherKind: VoucherKindDefinition,
  today = formatDateAsArcaDate(new Date()),
): BillingDateRange {
  validateConceptDateInputs(input, voucherKind);

  // Todo sale de `today`: las fechas sin año se completan con el año mas cercano a ese dia, no al reloj. Las reglas
  // (`billing.rules.ts`) son las mismas que usa el asistente al preguntar.
  const context: BillingRuleContext = { today, voucherKind };

  assertRules([BILLING_DATE_WINDOW_RULE], input, context);

  const billingDate = resolveBillingDate(input, today);
  const serviceDates = input.concept === 'productos' ? undefined : resolveServiceDates(input, billingDate, context);

  if (!shouldSendPaymentDueDate(input, voucherKind)) {
    return { billingDate, ...serviceDates };
  }

  assertRules([DUE_DATE_MINIMUM_RULE], input, context);

  // FCE: el vencimiento no puede ser anterior a la fecha del comprobante ni a hoy (10164, WSFEv1 v4.7).
  const minimumPaymentDueDate = isElectronicCreditInvoice(voucherKind) ? maxArcaDate(billingDate, today) : billingDate;
  const paymentDueDate = input.paymentDueDate
    ? parseBillingDateInput(input.paymentDueDate, today)
    : input.dueDay
      ? resolvePaymentDateFromDueDay(input.dueDay, today)
      : maxArcaDate(serviceDates?.serviceEndDate ?? minimumPaymentDueDate, minimumPaymentDueDate);

  return { billingDate, paymentDueDate, ...serviceDates };
}
