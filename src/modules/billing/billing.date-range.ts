import {
  type CalendarDate,
  calendarDateToArcaDate,
  formatDateAsArcaDate,
  maxArcaDate,
  parseArgentineDateInputAsArcaDate,
} from '../../lib/dates/arca-date';
import { InputValidationError } from '../../lib/errors/app-error';

import { isElectronicCreditInvoice } from './billing.fce';
import type { BillingCommandInput } from './billing.schemas';
import type { VoucherKindDefinition } from './billing.types';
import {
  ensureDateOrder,
  validateBillingDateWindow,
  validateConceptDateInputs,
  validatePaymentDueDate,
} from './billing.validation';

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

const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

function arcaDateToCalendarDate(value: string): CalendarDate {
  return { day: Number(value.slice(6, 8)), month: Number(value.slice(4, 6)), year: Number(value.slice(0, 4)) };
}

/** Mediodia argentino (15 UTC) de una fecha ARCA, para completar fechas sin año desde ese dia. */
function arcaDateToReferenceInstant(value: string): Date {
  const { day, month, year } = arcaDateToCalendarDate(value);

  return new Date(Date.UTC(year, month - 1, day, 15));
}

/**
 * Fecha ARCA del proximo `dueDay`, contando desde `todayArcaDate`. La cuenta va en UTC para no cruzar zonas y
 * arranca del dia 1: sumar un mes al 31/03 daria el 1/05. Si el dia no existe en ese mes (31 en abril), es un error.
 */
function resolvePaymentDateFromDueDay(dueDay: number, todayArcaDate: string): string {
  const today = arcaDateToCalendarDate(todayArcaDate);
  const monthOffset = dueDay < today.day ? 1 : 0;
  const firstOfMonth = new Date(Date.UTC(today.year, today.month - 1 + monthOffset, 1));
  const year = firstOfMonth.getUTCFullYear();
  const monthIndex = firstOfMonth.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

  if (dueDay > daysInMonth) {
    throw new InputValidationError(
      `\`--dia ${dueDay}\` no existe en ${MONTH_NAMES[monthIndex]} de ${year}. Indicá la fecha exacta con \`--vto\`.`,
    );
  }

  return calendarDateToArcaDate({ day: dueDay, month: monthIndex + 1, year });
}

/**
 * Que fechas lleva el comprobante:
 * - servicios: FchServDesde, FchServHasta y FchVtoPago (10049)
 * - factura FCE: FchVtoPago siempre, aunque sea de productos (10163)
 * - NC/ND FCE: sin FchVtoPago salvo anulacion (10175)
 */
function shouldSendPaymentDueDate(input: BillingCommandInput, voucherKind: VoucherKindDefinition): boolean {
  if (voucherKind.isElectronicCredit) {
    return isElectronicCreditInvoice(voucherKind);
  }

  return input.concept !== 'productos';
}

function resolveServiceDates(
  input: BillingCommandInput,
  billingDate: string,
  referenceDate: Date,
): Required<Pick<BillingDateRange, 'serviceEndDate' | 'serviceStartDate'>> {
  const serviceEndDate = input.serviceEndDate
    ? parseArgentineDateInputAsArcaDate(input.serviceEndDate, referenceDate)
    : billingDate;
  const serviceStartDate = input.serviceStartDate
    ? parseArgentineDateInputAsArcaDate(input.serviceStartDate, referenceDate)
    : serviceEndDate;

  ensureDateOrder(serviceStartDate, serviceEndDate);

  return { serviceEndDate, serviceStartDate };
}

export function resolveBillingDateRange(
  input: BillingCommandInput,
  voucherKind: VoucherKindDefinition,
  today = formatDateAsArcaDate(new Date()),
): BillingDateRange {
  validateConceptDateInputs(input, voucherKind);

  // Todo sale de `today`: las fechas sin año se completan con el año mas cercano a ese dia, no al reloj.
  const referenceDate = arcaDateToReferenceInstant(today);
  const billingDate = input.billingDate ? parseArgentineDateInputAsArcaDate(input.billingDate, referenceDate) : today;

  validateBillingDateWindow(billingDate, today, input.concept, voucherKind);

  const serviceDates =
    input.concept === 'productos' ? undefined : resolveServiceDates(input, billingDate, referenceDate);

  if (!shouldSendPaymentDueDate(input, voucherKind)) {
    return { billingDate, ...serviceDates };
  }

  // FCE: el vencimiento no puede ser anterior a la fecha del comprobante ni a hoy (10164).
  const minimumPaymentDueDate = isElectronicCreditInvoice(voucherKind) ? maxArcaDate(billingDate, today) : billingDate;
  const paymentDueDate = input.paymentDueDate
    ? parseArgentineDateInputAsArcaDate(input.paymentDueDate, referenceDate)
    : input.dueDay
      ? resolvePaymentDateFromDueDay(input.dueDay, today)
      : maxArcaDate(serviceDates?.serviceEndDate ?? minimumPaymentDueDate, minimumPaymentDueDate);

  validatePaymentDueDate(paymentDueDate, minimumPaymentDueDate);

  return { billingDate, paymentDueDate, ...serviceDates };
}
