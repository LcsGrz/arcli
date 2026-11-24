import {
  arcaDateToInstant,
  type CalendarDate,
  calendarDateToArcaDate,
  formatArcaDateAsArgentineDate,
  maxArcaDate,
  parseArgentineDateInputAsArcaDate,
} from '../../lib/dates/arca-date';
import { InputValidationError } from '../../lib/errors/app-error';

import type { BillingCommandInput } from './billing.schemas';
import type { VoucherKindDefinition } from './billing.types';
import { isFceInvoice } from './voucher-kind-map';

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

/** Una fecha escrita (`--fecha 10`, `15/11`) en fecha ARCA, completando lo que falta desde `today` (yyyymmdd). */
export function parseBillingDateInput(value: string, today: string): string {
  return parseArgentineDateInputAsArcaDate(value, arcaDateToInstant(today));
}

/** La fecha del comprobante: la escrita o, como el CLI sin `--fecha`, hoy. */
export function resolveBillingDate(input: Pick<Partial<BillingCommandInput>, 'billingDate'>, today: string): string {
  return input.billingDate ? parseBillingDateInput(input.billingDate, today) : today;
}

/**
 * Fecha ARCA del proximo `dueDay`, contando desde `todayArcaDate`. La cuenta va en UTC para no cruzar zonas y
 * arranca del dia 1: sumar un mes al 31/03 daria el 1/05. Si el dia no existe en ese mes (31 en abril), es un error.
 */
export function resolvePaymentDateFromDueDay(dueDay: number, todayArcaDate: string): string {
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
 * Que fechas lleva el comprobante (codigos de WSFEv1 v4.7):
 * - servicios: FchServDesde, FchServHasta y FchVtoPago (10049)
 * - factura FCE: FchVtoPago siempre, aunque sea de productos (10163)
 * - NC/ND FCE: sin FchVtoPago. La 10175 lo permite (opcional) en las de anulacion; no mandarlo nunca es propio
 */
export function shouldSendPaymentDueDate(
  input: Pick<Partial<BillingCommandInput>, 'concept'>,
  voucherKind: VoucherKindDefinition,
): boolean {
  if (voucherKind.isElectronicCredit) {
    return isFceInvoice(voucherKind);
  }

  return input.concept !== 'productos';
}

/**
 * El vencimiento minimo: la fecha del comprobante y, en la factura FCE, tampoco antes de hoy (10164, WSFEv1 v4.7). Lo
 * usan la regla (`DUE_DATE_MINIMUM_RULE`) y el vencimiento por defecto del CLI.
 */
export function minimumPaymentDueDate(billingDate: string, today: string, voucherKind: VoucherKindDefinition): string {
  return isFceInvoice(voucherKind) ? maxArcaDate(billingDate, today) : billingDate;
}

/**
 * ARCA numera en orden de fecha: con una futura, los que siguen de ese tipo y punto de venta no pueden ir con una
 * anterior. Es la 10016 en A, B y C (WSFEv1 v4.7) y la 1535 en la E (WSFEX v3.1.0). Las fechas, en yyyymmdd.
 */
export function futureDateWarnings(options: {
  readonly code: 10016 | 1535;
  /** Los que siguen, con su articulo: `las próximas facturas C`. */
  readonly next: string;
  readonly pointOfSale: number;
  readonly today: string;
  readonly voucherDate: string;
}): string[] {
  return options.voucherDate > options.today
    ? [
        `La fecha del comprobante (${formatArcaDateAsArgentineDate(options.voucherDate)}) es futura: ${options.next} del punto de venta ${options.pointOfSale} van a tener que llevar esa fecha o una posterior, porque ARCA rechaza una anterior (error ${options.code}).`,
      ]
    : [];
}
