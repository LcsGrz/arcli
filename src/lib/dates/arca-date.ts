import { InputValidationError } from '../errors/app-error';

const ARGENTINE_DATE_FORMAT_HINT = 'Use D, DD, D-MM, D/MM, D-MM-YY, D/MM/YY, D-MM-YYYY o D/MM/YYYY.';

// Usa la fecha local: con toISOString, despues de las 21 hs en Argentina la fecha saltaba al dia siguiente.
export function formatDateAsArcaDate(value: Date): string {
  const year = String(value.getFullYear());
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');

  return `${year}${month}${day}`;
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
    throw new InputValidationError(`La fecha "${value}" no es valida. ${ARGENTINE_DATE_FORMAT_HINT}`);
  }

  const [, rawDay, , rawMonth, explicitYear] = dateMatch;
  const day = rawDay.padStart(2, '0');
  const month = (rawMonth ?? String(referenceDate.getMonth() + 1)).padStart(2, '0');
  const year = resolveYear(explicitYear, referenceDate);
  const date = new Date(Number(year), Number(month) - 1, Number(day));

  if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) {
    throw new InputValidationError(`La fecha "${value}" no es valida.`);
  }

  return `${year}${month}${day}`;
}

function resolveYear(explicitYear: string | undefined, referenceDate: Date): string {
  if (!explicitYear) {
    return String(referenceDate.getFullYear());
  }

  return explicitYear.length === 2 ? `20${explicitYear}` : explicitYear;
}
