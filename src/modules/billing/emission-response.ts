import { addDaysToArcaDate } from '../../lib/dates/arca-date';

/*
 * Lo que contesta ARCA a la llamada que emite, A, B, C y E: si hay CAE, el resultado se muestra aunque un dato accesorio
 * (un evento, una observacion, el vencimiento) venga con otra forma. Solo si no se puede saber si hay CAE falla, y sale
 * `EmissionUncertainError` (ERR-16).
 */

/** No dice que ARCA contestó ni que se mando: pudo fallar antes, al armar la solicitud. */
const UNEXPECTED_EMISSION_ERROR = 'hubo un error inesperado al emitir';

/** Hasta donde se cita el mensaje original. */
const MAX_REASON_LENGTH = 200;

/** Lo que dice la fila de un error o un evento que ARCA mando sin texto. */
export const NO_DETAIL_TEXT = 'ARCA no informó el detalle.';

/**
 * Un error propio de JavaScript (`Cannot read properties of undefined`): el SDK o ARCLI leyeron algo que no estaba. Los
 * de red tambien pueden ser `TypeError` (`fetch failed`, con su `cause`, o los de Node, con `code`): esos quedan igual.
 */
function isInternalError(error: Error): boolean {
  const isBuiltIn =
    error instanceof TypeError ||
    error instanceof RangeError ||
    error instanceof ReferenceError ||
    error instanceof SyntaxError;

  return isBuiltIn && error.cause === undefined && !('code' in error);
}

function readReason(cause: unknown): string | null {
  if (typeof cause !== 'object' || cause === null) {
    return null;
  }

  // node-soap rechaza asi, sin `Error`, si lo que llega no es XML. Solo `faultstring`: `body` trae la respuesta cruda.
  const { Fault: fault, message } = cause as { readonly Fault?: { readonly faultstring?: unknown }; message?: unknown };

  return readResponseText(fault?.faultstring) ?? readResponseText(message);
}

/**
 * El motivo de una emision sin confirmar, para mostrar. La red, un timeout o un SOAP fault conservan su error; lo demas
 * va con un texto propio, el mensaje original para poder diagnosticarlo y el original en `cause`.
 */
export function describeEmissionFailure(cause: unknown): Error {
  if (cause instanceof Error && !isInternalError(cause)) {
    return cause;
  }

  if (typeof cause === 'string' && cause.trim()) {
    return new Error(cause, { cause });
  }

  const reason = readReason(cause)?.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON_LENGTH);

  return new Error(`${UNEXPECTED_EMISSION_ERROR}${reason ? ` (${reason})` : ''}`, { cause });
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
    throw new Error('el CAE de la respuesta no es un texto ni un número');
  }

  return text?.trim() ?? null;
}

/** El vencimiento del CAE en `yyyymmdd`; si no es una fecha, `null`: no es motivo para perder el CAE. */
export function readCaeExpiration(value: unknown): string | null {
  const digits = (readResponseText(value) ?? '').replace(/\D/g, '').slice(0, 8);

  return /^20\d{6}$/.test(digits) && addDaysToArcaDate(digits, 0) === digits ? digits : null;
}
