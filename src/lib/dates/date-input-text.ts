/**
 * Que fecha es un flag o una clave: un dia suelto (`--fecha`, `--vto`...) o una punta de un rango (`--sd`/`--sh`,
 * `--pd`/`--ph`). Las palabras de mes solo valen en las puntas: en "desde" dan el dia 1 y en "hasta", el ultimo.
 */
export type DateInputRole = 'day' | 'from' | 'to';

/** Tope de `+N` y `-N`: mas que cualquier vencimiento real, y frena un typo antes de que la fecha salga de rango. */
export const MAX_RELATIVE_DAYS = 999;

/** Los formatos de una fecha escrita a mano que acepta `parseArgentineDateInputAsArcaDate`. */
const DATE_FORMATS_TEXT = 'D, DD, D-MM, D/MM, D-MM-YY, D/MM/YY, D-MM-YYYY o D/MM/YYYY';

/** Las fechas relativas de un dia: la ayuda de las preguntas de fecha del asistente y parte de cada error. */
export const RELATIVE_DAY_WORDS_TEXT = 'hoy, ayer, +N o -N';

const MONTH_WORDS_TEXT = 'mes-actual o mes-pasado';

/**
 * El texto de los formatos aceptados, el mismo en los flags, `--cargar`, `fce-obligado` y el asistente (TUI-18). Sin
 * nombres de flags, asi el asistente lo usa tal cual. En desde y hasta suma las palabras de mes.
 */
export function dateInputHint(role: DateInputRole = 'day'): string {
  const relative = `${RELATIVE_DAY_WORDS_TEXT} (días desde hoy, hasta ${MAX_RELATIVE_DAYS})`;

  return role === 'day'
    ? `Usá ${DATE_FORMATS_TEXT}. También: ${relative}.`
    : `Usá ${DATE_FORMATS_TEXT}. También: ${relative}, ${MONTH_WORDS_TEXT}.`;
}
