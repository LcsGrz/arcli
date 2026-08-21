import { InputValidationError } from '../errors/app-error';

const ARGENTINE_DATE_FORMAT_HINT = 'Use D, DD, D-MM, D/MM, D-MM-YY, D/MM/YY, D-MM-YYYY o D/MM/YYYY.';

export function formatDateAsArcaDate(value: Date): string {
  return value.toISOString().slice(0, 10).replaceAll('-', '');
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
