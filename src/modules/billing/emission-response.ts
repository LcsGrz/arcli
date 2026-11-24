import { addDaysToArcaDate } from '../../lib/dates/arca-date';

/*
 * Lo que contesta ARCA a la llamada que emite, A, B, C y E: si hay CAE, el resultado se muestra aunque un dato accesorio
 * (un evento, una observacion, el vencimiento) venga con otra forma. Solo si no se puede saber si hay CAE falla, y sale
 * `EmissionUncertainError` (ERR-16).
 */

/** Lo que dice `EMISSION_UNCERTAIN` si la respuesta no se entiende, en vez del texto interno de JavaScript. */
const UNREADABLE_RESPONSE = 'ARCA contestó algo que ARCLI no pudo leer';

/** El error de una respuesta que no se entiende; el original queda en `cause`. */
export function unreadableResponseError(cause?: unknown): Error {
  return new Error(UNREADABLE_RESPONSE, { cause });
}

/**
 * Un error propio de JavaScript (`Cannot read properties of undefined`): el SDK o ARCLI leyeron algo que no estaba. Los
 * de red tambien pueden ser `TypeError` (`fetch failed`, con su `cause`, o los de Node, con `code`): esos quedan igual.
 */
export function isInternalError(error: unknown): boolean {
  const isBuiltIn =
    error instanceof TypeError ||
    error instanceof RangeError ||
    error instanceof ReferenceError ||
    error instanceof SyntaxError;

  return isBuiltIn && error.cause === undefined && !('code' in error);
}

/** El texto de un dato de ARCA, sin recortar; un numero vale como texto y cualquier otra cosa, no. */
export function readResponseText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return typeof value === 'string' && value.trim() ? value : null;
}

/** El CAE, o `null` si ARCA no lo dio. Si vino algo que no es un CAE, falla: no se sabe si hay. */
export function readCae(value: unknown): string | null {
  if (value === undefined || value === null || value === 0) {
    return null;
  }

  const text = readResponseText(value);

  if (text === null && typeof value !== 'string') {
    throw unreadableResponseError();
  }

  return text?.trim() ?? null;
}

/** El vencimiento del CAE en `yyyymmdd`; si no es una fecha, `null`: no es motivo para perder el CAE. */
export function readCaeExpiration(value: unknown): string | null {
  const digits = (readResponseText(value) ?? '').replace(/\D/g, '').slice(0, 8);

  return /^20\d{6}$/.test(digits) && addDaysToArcaDate(digits, 0) === digits ? digits : null;
}
