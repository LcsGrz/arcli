import { InputValidationError } from '../errors/app-error';

export const ARGENTINE_DATE_FORMAT_HINT = 'Usá D, DD, D-MM, D/MM, D-MM-YY, D/MM/YY, D-MM-YYYY o D/MM/YYYY.';

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

export function maxArcaDate(...values: string[]): string {
  return values.reduce((latest, value) => (value > latest ? value : latest));
}

export function formatArcaDateAsArgentineDate(value: string): string {
  return `${value.slice(6, 8)}/${value.slice(4, 6)}/${value.slice(0, 4)}`;
}

export function parseArgentineDateInputAsArcaDate(value: string, referenceDate = new Date()): string {
  const normalizedValue = value.trim();
  const dateMatch = /^(\d{1,2})(?:([-/])(\d{1,2})(?:\2(\d{2}|\d{4}))?)?$/.exec(normalizedValue);

  if (!dateMatch) {
    throw new InputValidationError(`La fecha "${value}" no es válida. ${ARGENTINE_DATE_FORMAT_HINT}`);
  }

  const [, rawDay, , rawMonth, explicitYear] = dateMatch;
  const today = toArgentineCalendarDate(referenceDate);
  const day = rawDay.padStart(2, '0');
  const month = (rawMonth ?? String(today.month)).padStart(2, '0');
  const year = resolveYear(explicitYear, Number(month), Number(day), today);
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    throw new InputValidationError(`La fecha "${value}" no es válida. ${ARGENTINE_DATE_FORMAT_HINT}`);
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
    return explicitYear.length === 2 ? `20${explicitYear}` : explicitYear;
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
