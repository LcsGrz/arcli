import {
  addDaysToArcaDate,
  arcaDateToInstant,
  formatArcaDateAsArgentineDate,
  formatDateAsArcaDate,
  lastDayOfArcaMonth,
  parseArgentineDateInputAsArcaDate,
  parseFullArgentineDateAsArcaDate,
} from '../../lib/dates/arca-date';
import { assertRules } from '../../lib/rules/rules';

import type { ExportRule } from './export.rule-types';
import {
  DEFAULT_EXPORT_TYPE,
  EXPORT_TYPES_WITH_PAYMENT_DATE,
  type ExportType,
  SERVICES_EXPORT_TYPE,
} from './export.types';

/** La fecha del comprobante, en formato ARCA: por defecto hoy en Argentina. */
export function resolveExportVoucherDate(value: string | undefined, now: Date): string {
  return value?.trim() ? parseArgentineDateInputAsArcaDate(value, now) : formatDateAsArcaDate(now);
}

/**
 * Enero de un año bisiesto: desde ahi se lee cualquier fecha incompleta que exista (`31`, `29/2`). Solo distingue una
 * incompleta de una ilegible; la fecha que sale no se usa.
 */
const READABLE_DATE_REFERENCE = '20240115';

/**
 * Una fecha escrita, para una regla: completa (dd/mm/aaaa) no necesita `today` (yyyymmdd); a la que le falta el mes o el
 * año la completa desde ahi, y sin `today` no se puede resolver (`undefined`). Una ilegible da error siempre.
 */
export function resolveExportRuleDate(value: string, today: string | undefined): string | undefined {
  const full = parseFullArgentineDateAsArcaDate(value);

  if (full) {
    return full;
  }

  const date = parseArgentineDateInputAsArcaDate(value, arcaDateToInstant(today ?? READABLE_DATE_REFERENCE));

  return today ? date : undefined;
}

/** Cuantos dias antes y despues de la fecha de envio acepta ARCA la fecha de la E (1500, WSFEX v3.1.0). */
const EXPORT_DATE_WINDOW_DAYS = 5;

/**
 * La fecha mas temprana que ARCA acepta para la factura o la nota E (1500, WSFEX v3.1.0), la misma ventana que
 * `EXPORT_VOUCHER_DATE_WINDOW_RULE`: hoy - 5 (yyyymmdd).
 */
export function earliestExportVoucherDate(today: string): string {
  return addDaysToArcaDate(today, -EXPORT_DATE_WINDOW_DAYS);
}

/**
 * ARCA 1500 (WSFEX v3.1.0): la fecha de la factura y de las notas E va de hoy - 5 a hoy + 5 (N = fecha de envio) y,
 * en servicios, no puede pasar del mes en curso. Testing lo confirma: +1 aprobada, +6 y -6 rechazadas con el periodo
 * en el mensaje. Una fecha futura vale (por ejemplo, la del embarque del lunes), pero traba el punto de venta: ver
 * `futureDateWarnings`. Sin `today` no corre.
 */
export const EXPORT_VOUCHER_DATE_WINDOW_RULE: ExportRule = {
  check: (input, { today }) => {
    if (!today) {
      return undefined;
    }

    const exportType = input.exportType ?? DEFAULT_EXPORT_TYPE;
    const voucherDate = resolveExportVoucherDate(input.voucherDate, arcaDateToInstant(today));
    const from = earliestExportVoucherDate(today);
    const windowEnd = addDaysToArcaDate(today, EXPORT_DATE_WINDOW_DAYS);
    const monthEnd = lastDayOfArcaMonth(today);
    const capsAtMonthEnd = exportType === SERVICES_EXPORT_TYPE && monthEnd < windowEnd;
    const to = capsAtMonthEnd ? monthEnd : windowEnd;

    if (voucherDate >= from && voucherDate <= to) {
      return undefined;
    }

    const range = `del ${formatArcaDateAsArgentineDate(from)} al ${formatArcaDateAsArgentineDate(to)}`;

    return `La fecha del comprobante (${formatArcaDateAsArgentineDate(voucherDate)}) está fuera de lo que acepta ARCA: ${range}, hasta ${EXPORT_DATE_WINDOW_DAYS} días antes o después de hoy${capsAtMonthEnd ? ' y, en servicios, no después del fin de mes' : ''} (error 1500).`;
  },
  fields: ['voucherDate'],
  id: 'export-voucher-date-window',
};

/** El mismo control que `EXPORT_VOUCHER_DATE_WINDOW_RULE`, con las fechas ya resueltas (yyyymmdd). */
export function assertExportVoucherDate(options: {
  readonly exportType: ExportType;
  readonly today: string;
  readonly voucherDate: string;
}): void {
  assertRules(
    [EXPORT_VOUCHER_DATE_WINDOW_RULE],
    { exportType: options.exportType, voucherDate: formatArcaDateAsArgentineDate(options.voucherDate) },
    { today: options.today },
  );
}

/**
 * `Fecha_pago` va solo en la factura de servicios u otros (1672): en las notas ARCA la rechaza (1673, WSFEX v3.1.0) y en
 * bienes tambien, aunque el manual no lo diga (visto en testing, #204).
 */
export function exportTypeTakesPaymentDate(exportType: ExportType, isNote: boolean): boolean {
  return !isNote && EXPORT_TYPES_WITH_PAYMENT_DATE.includes(exportType);
}
