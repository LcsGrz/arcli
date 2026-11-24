import { addDaysToArcaDate } from '../../lib/dates/arca-date';

/*
 * Lo que contesta ARCA a la llamada que emite, A, B, C y E: si hay CAE, el resultado se muestra aunque un dato accesorio
 * (un evento, una observacion, el vencimiento) venga con otra forma. Solo si no se puede saber si hay CAE falla, y sale
 * `EmissionUncertainError` (ERR-16, ERR-20).
 */

/** No dice que ARCA contestó ni que se mando: pudo fallar antes, al armar la solicitud. */
const UNEXPECTED_EMISSION_ERROR = 'hubo un error inesperado al emitir';

/** Hasta donde se cita el mensaje original. */
const MAX_REASON_LENGTH = 200;

/** Lo que dice la fila de un error o un evento que ARCA mando sin texto. */
export const NO_DETAIL_TEXT = 'ARCA no informó el detalle.';

/** Lo que se sugiere si hay CAE y ademas un error: las sugerencias del error pueden proponer emitir de nuevo. */
export const EMITTED_WITH_ERROR_SUGGESTION =
  'El comprobante está emitido: ARCA dio el CAE, aunque también informó un error. No lo repitas: revisá el error.';

/**
 * Errores internos de ARCA (500 de aplicacion, 501 de base de datos): no son validaciones y no dicen si se emitio. Sin
 * fuente en el repo (el manual no esta); son los que decidio quien mantiene el proyecto en ERR-20.
 */
const INTERNAL_ARCA_ERRORS: ReadonlySet<number> = new Set([500, 501]);

export type EmissionStatus = 'aprobado' | 'observado' | 'rechazado';

/** Un error de la respuesta: el codigo, si se puede leer, y lo que se cita en el motivo. */
export interface EmissionAnswerError {
  readonly code?: number;
  readonly message?: string | null;
}

/**
 * El estado de lo que contesto ARCA a la llamada que emite, para todas las familias (ERR-20). Manda el CAE: con CAE
 * esta emitido, aunque haya un error. Sin CAE es un rechazo si ARCA lo dice (`R`) o si hay un error que no es interno
 * y ningun resultado. Lo demas (vacia, aprobada sin CAE, un error interno) no dice si se emitio: falla, y quien llama
 * lo convierte en `EmissionUncertainError`.
 */
export function resolveEmissionStatus(answer: {
  readonly cae: string | null;
  readonly errors: readonly EmissionAnswerError[];
  readonly hasObservations: boolean;
  /** `R` en el resultado del comprobante o, sin el, en la cabecera. */
  readonly rejected: boolean;
  readonly result: string | null;
  /** Textos que no cuentan como error, pero explican el motivo. */
  readonly texts?: readonly string[];
}): EmissionStatus {
  const { cae, errors, hasObservations, rejected, result, texts = [] } = answer;

  if (rejected) {
    return 'rechazado';
  }

  if (cae !== null) {
    return result === 'A' && !hasObservations && errors.length === 0 ? 'aprobado' : 'observado';
  }

  if (result === null && errors.some(({ code }) => !INTERNAL_ARCA_ERRORS.has(Number(code)))) {
    return 'rechazado';
  }

  const reasons = [
    ...errors.map(({ code, message }) => [code ?? '', message ?? ''].join(' ').trim() || NO_DETAIL_TEXT),
    ...texts,
  ].join('; ');

  throw new Error(
    shortenReason(
      `ARCA contestó sin CAE, ${result === null ? 'sin resultado' : `con el resultado ${result}`} y ${reasons ? `con errores: ${reasons}` : 'sin errores'}`,
    ),
  );
}

/** Una linea, sin pasarse del largo. */
function shortenReason(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON_LENGTH);
}

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

  const reason = shortenReason(readReason(cause) ?? '');

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
