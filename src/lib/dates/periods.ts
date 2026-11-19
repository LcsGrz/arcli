import { calendarDateToArcaDate, formatArcaDateAsArgentineDate, toArgentineCalendarDate } from './arca-date';

/** Un mes de punta a punta: `from` es el dia 1 y `to`, el ultimo dia. */
export interface MonthPeriod {
  readonly from: string;
  readonly to: string;
}

/** Periodos de servicio para repetir una factura: el mes actual o el anterior, en formato DD/MM/YYYY. */
export type ServicePeriod = MonthPeriod;

/**
 * El mes de hoy (`monthsAgo` 0) o uno anterior, en fechas ARCA (yyyymmdd). "Hoy" es la fecha argentina; la cuenta del
 * mes se hace en UTC de punta a punta (`Date.UTC` resuelve el mes 0 y los negativos al año anterior).
 */
export function monthArcaPeriod(now: Date, monthsAgo: number): MonthPeriod {
  const today = toArgentineCalendarDate(now);
  const first = new Date(Date.UTC(today.year, today.month - 1 - monthsAgo, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const toArca = (value: Date) =>
    calendarDateToArcaDate({ day: value.getUTCDate(), month: value.getUTCMonth() + 1, year: value.getUTCFullYear() });

  return { from: toArca(first), to: toArca(last) };
}

function toArgentinePeriod(period: MonthPeriod): ServicePeriod {
  return { from: formatArcaDateAsArgentineDate(period.from), to: formatArcaDateAsArgentineDate(period.to) };
}

export function currentMonthPeriod(now: Date): ServicePeriod {
  return toArgentinePeriod(monthArcaPeriod(now, 0));
}

export function previousMonthPeriod(now: Date): ServicePeriod {
  return toArgentinePeriod(monthArcaPeriod(now, 1));
}
