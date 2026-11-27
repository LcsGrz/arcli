import { InputValidationError } from '../errors/app-error';

import { dateInputHint } from './date-input-text';

export interface CalendarDate {
  readonly day: number;
  /** 1 a 12. */
  readonly month: number;
  readonly year: number;
}

const ARGENTINE_DATE_PARTS = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'America/Argentina/Buenos_Aires',
  year: 'numeric',
});

/**
 * Dia calendario en Argentina de un instante. ARCA trabaja con la fecha argentina: en un servidor con TZ=UTC,
 * despues de las 21 hs la fecha local ya es la del dia siguiente.
 */
export function toArgentineCalendarDate(value: Date): CalendarDate {
  const parts = Object.fromEntries(ARGENTINE_DATE_PARTS.formatToParts(value).map((part) => [part.type, part.value]));

  return { day: Number(parts.day), month: Number(parts.month), year: Number(parts.year) };
}

export function calendarDateToArcaDate(value: CalendarDate): string {
  return `${value.year}${String(value.month).padStart(2, '0')}${String(value.day).padStart(2, '0')}`;
}

/** Fecha ARCA (yyyymmdd) del dia en Argentina en ese instante. */
export function formatDateAsArcaDate(value: Date): string {
  return calendarDateToArcaDate(toArgentineCalendarDate(value));
}

function arcaDateToUtcTime(value: string): number {
  return Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
}

/** Dias entre dos fechas ARCA (yyyymmdd): positivo si `to` es posterior a `from`. */
export function diffArcaDatesInDays(from: string, to: string): number {
  return Math.round((arcaDateToUtcTime(to) - arcaDateToUtcTime(from)) / 86_400_000);
}

/** La fecha ARCA (yyyymmdd) `days` dias despues (o antes, con un numero negativo). */
export function addDaysToArcaDate(value: string, days: number): string {
  return new Date(arcaDateToUtcTime(value) + days * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
}

/** Ultimo dia del mes de una fecha ARCA (yyyymmdd). */
export function lastDayOfArcaMonth(arcaDate: string): string {
  const day = new Date(Date.UTC(Number(arcaDate.slice(0, 4)), Number(arcaDate.slice(4, 6)), 0)).getUTCDate();

  return `${arcaDate.slice(0, 6)}${String(day).padStart(2, '0')}`;
}

export function minArcaDate(...values: string[]): string {
  return values.reduce((earliest, value) => (value < earliest ? value : earliest));
}

export function maxArcaDate(...values: string[]): string {
  return values.reduce((latest, value) => (value > latest ? value : latest));
}

export function formatArcaDateAsArgentineDate(value: string): string {
  return `${value.slice(6, 8)}/${value.slice(4, 6)}/${value.slice(0, 4)}`;
}

/** Periodo ARCA (yyyymm) como mes y año: `201309` → `09/2013`. */
export function formatArcaPeriodAsArgentinePeriod(value: string): string {
  return `${value.slice(4, 6)}/${value.slice(0, 4)}`;
}

/** Mediodia argentino (15 UTC) de una fecha ARCA (yyyymmdd): completa una fecha sin año desde ese dia. */
export function arcaDateToInstant(value: string): Date {
  return new Date(arcaDateToUtcTime(value) + 15 * 3_600_000);
}

/** Una fecha escrita a mano, completando desde el dia de `now` en Argentina el mes o el año que falten. */
export function parseArgentineDateInputAsArcaDate(value: string, now: Date): string {
  const normalizedValue = value.trim();
  const dateMatch = /^(\d{1,2})(?:([-/])(\d{1,2})(?:\2(\d{2}|\d{4}))?)?$/.exec(normalizedValue);

  if (!dateMatch) {
    throw new InputValidationError(`La fecha "${value}" no es válida. ${dateInputHint()}`);
  }

  // El grupo del dia es obligatorio en la regex: el default '' nunca se usa, solo le dice al tipo que hay string.
  const [, rawDay = '', , rawMonth, explicitYear] = dateMatch;
  const today = toArgentineCalendarDate(now);
  const day = rawDay.padStart(2, '0');
  const month = (rawMonth ?? String(today.month)).padStart(2, '0');

  return toValidArcaDate(value, day, month, resolveYear(explicitYear, Number(month), Number(day), today));
}

/** Una fecha escrita con dia, mes y año (`1/03/2020`): no depende de hoy. `undefined` si le falta algo. */
export function parseFullArgentineDateAsArcaDate(value: string): string | undefined {
  const match = /^(\d{1,2})([-/])(\d{1,2})\2(\d{2}|\d{4})$/.exec(value.trim());

  if (!match) {
    return undefined;
  }

  // Los tres grupos son obligatorios en la regex: los defaults '' nunca se usan, solo le dicen al tipo que hay string.
  const [, day = '', , month = '', year = ''] = match;

  return toValidArcaDate(value, day.padStart(2, '0'), month.padStart(2, '0'), toFullYear(year));
}

function toFullYear(year: string): string {
  return year.length === 2 ? `20${year}` : year;
}

/** La fecha ARCA de un dia, mes y año ya completos, si existe en el calendario. `value` es lo escrito, para el error. */
function toValidArcaDate(value: string, day: string, month: string, year: string): string {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    throw new InputValidationError(`La fecha "${value}" no es válida. ${dateInputHint()}`);
  }

  return `${year}${month}${day}`;
}

/**
 * Sin año, el de la fecha mas cercana a hoy: el 5/1 `1/12` es diciembre pasado y el 28/12 `10/1` es enero que
 * viene. A igual distancia gana el año actual. Solo cuentan los años donde la fecha existe: el 1/9/2028 `29/2` es el
 * 29/02/2028, aunque el 1/3/2029 (lo que daria `Date.UTC` para un 29/02/2029) este mas cerca. Si no existe en
 * ninguno, devuelve el actual y la fecha da error.
 */
function resolveYear(explicitYear: string | undefined, month: number, day: number, today: CalendarDate): string {
  if (explicitYear) {
    return toFullYear(explicitYear);
  }

  const todayTime = Date.UTC(today.year, today.month - 1, today.day);
  const distance = (year: number) => Math.abs(Date.UTC(year, month - 1, day) - todayTime);
  const exists = (year: number) => new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day;
  const candidates = [today.year, today.year - 1, today.year + 1].filter(exists);
  const closest = candidates.reduce<number | undefined>(
    (best, year) => (best === undefined || distance(year) < distance(best) ? year : best),
    undefined,
  );

  return String(closest ?? today.year);
}
