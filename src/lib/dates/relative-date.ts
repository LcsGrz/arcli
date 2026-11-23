import { InputValidationError } from '../errors/app-error';

import {
  addDaysToArcaDate,
  formatArcaDateAsArgentineDate,
  formatDateAsArcaDate,
  parseArgentineDateInputAsArcaDate,
} from './arca-date';
import { dateInputHint, type DateInputRole, MAX_RELATIVE_DAYS, RELATIVE_DAY_WORDS_TEXT } from './date-input-text';
import { monthArcaPeriod } from './periods';

const MONTH_WORDS = { 'mes-actual': 0, 'mes-pasado': 1 } as const;

function isMonthWord(value: string): value is keyof typeof MONTH_WORDS {
  return value in MONTH_WORDS;
}

/** Una palabra (letras y guiones) o algo que empieza con `+`/`-`: nunca es una fecha escrita a mano. */
function looksRelative(value: string): boolean {
  return /^[+-]/.test(value) || /^[a-zñáéíóú-]+$/.test(value);
}

/**
 * La fecha ARCA (yyyymmdd) de una fecha relativa (`hoy`, `ayer`, `+N`, `-N`, `mes-actual`, `mes-pasado`), sin
 * distinguir mayusculas. `now` es la referencia: "hoy" es su fecha argentina. Devuelve `undefined` si el valor no es
 * relativo (una fecha escrita a mano sigue su camino de siempre) y tira si parece relativo pero no es valido.
 *
 * @internal Exportado para los tests.
 */
export function parseRelativeDateAsArcaDate(value: string, role: DateInputRole, now: Date): string | undefined {
  const normalized = value.trim().toLowerCase();

  if (!looksRelative(normalized)) {
    return undefined;
  }

  const today = formatDateAsArcaDate(now);

  if (normalized === 'hoy') {
    return today;
  }

  if (normalized === 'ayer') {
    return addDaysToArcaDate(today, -1);
  }

  if (isMonthWord(normalized)) {
    if (role === 'day') {
      throw new InputValidationError(
        `\`${value.trim()}\` es un mes y esta fecha es de un día: las palabras de mes valen solo en desde y hasta (\`--sd\`/\`--sh\`, \`--pd\`/\`--ph\`). Acá usá una fecha o ${RELATIVE_DAY_WORDS_TEXT}.`,
      );
    }

    const period = monthArcaPeriod(now, MONTH_WORDS[normalized]);

    return role === 'from' ? period.from : period.to;
  }

  const offset = /^([+-])(\d+)$/.exec(normalized);

  if (!offset) {
    throw new InputValidationError(`La fecha "${value.trim()}" no es válida. ${dateInputHint(role)}`);
  }

  const days = Number(offset[2]);

  if (days > MAX_RELATIVE_DAYS) {
    throw new InputValidationError(
      `La fecha "${value.trim()}" está demasiado lejos: \`+N\` y \`-N\` van hasta ${MAX_RELATIVE_DAYS} días.`,
    );
  }

  return addDaysToArcaDate(today, offset[1] === '-' ? -days : days);
}

/**
 * La fecha ARCA (yyyymmdd) de lo que escribe el usuario, en un flag, en `--cargar` o en el asistente: una relativa
 * (`hoy`, `-3`, `mes-pasado` en desde y hasta) o una escrita a mano (`5`, `15/11`, `15/11/2026`), que sin año toma
 * la mas cercana a `now`. La usan el asistente y `fce-obligado`; los flags de facturacion y de la E resuelven aca las
 * relativas (`resolveRelativeDateInput`) y la fecha escrita a mano la lee cada modulo con `parseArgentineDateInputAsArcaDate`.
 * Los errores de los tres caminos dicen lo mismo: `dateInputHint`.
 */
export function parseDateInputAsArcaDate(value: string, role: DateInputRole, now: Date): string {
  const relative = parseRelativeDateAsArcaDate(value, role, now);

  if (relative !== undefined) {
    return relative;
  }

  try {
    return parseArgentineDateInputAsArcaDate(value, now);
  } catch (error) {
    if (error instanceof InputValidationError) {
      throw new InputValidationError(`La fecha "${value.trim()}" no es válida. ${dateInputHint(role)}`);
    }

    throw error;
  }
}

/**
 * Lo que leen los flags y `--cargar`: una fecha relativa pasa a DD/MM/YYYY (con año, asi no se reinterpreta) y una
 * escrita a mano queda igual. Asi la vista previa, las validaciones y el `--json` ven siempre la fecha resuelta.
 */
export function resolveRelativeDateInput<T extends string | undefined>(value: T, role: DateInputRole, now: Date): T {
  if (value === undefined) {
    return value;
  }

  const arcaDate = parseRelativeDateAsArcaDate(value, role, now);

  return (arcaDate === undefined ? value : formatArcaDateAsArgentineDate(arcaDate)) as T;
}
