import { asArray } from '../../lib/arrays/as-array';
import { POINT_OF_SALE_GUIDE_URL } from '../../lib/links';
import type { AuthorizationAnswer } from '../billing/authorization-answer';
import {
  type EmissionStatus,
  EMITTED_WITH_ERROR_SUGGESTION,
  EMITTED_WITH_OBSERVATION_SUGGESTION,
  NO_DETAIL_TEXT,
  readCae,
  readCaeExpiration,
  readErrorCode,
  readRejectedCae,
  readResponseText,
  resolveEmissionStatus,
  WSFEX_INTERNAL_ERRORS,
} from '../billing/emission-response';

import type { ExportResponseError, ExportResponseSummary } from './export.types';

// Sin comando: `parametros puntos-venta` lista los de wsfe y los de la E son de otro sistema.
const POINT_OF_SALE_HINT = `Revisá \`--punto-venta\`: la E usa un punto de venta de exportación por web service (WSFEX), distinto de los de A, B y C. Los ves en ARCA, en "Administración de puntos de venta y domicilios". Guía: ${POINT_OF_SALE_GUIDE_URL}`;

/** El codigo sale como vino: ARCA manda un numero. */
interface RawEvent {
  readonly EventCode?: number;
  readonly EventMsg?: unknown;
}

/**
 * WSFEX informa los errores en `FEXErr` y los avisos en `FEXEvents`, con el codigo en 0 cuando no hay nada que
 * decir: en la autorizacion exitosa manda `ErrCode: 0` con `ErrMsg: "OK"`, que no es un error.
 */
function toEntry(code: number | undefined, message: unknown): ExportResponseError[] {
  if (!code) {
    return [];
  }

  return [{ code, message: readResponseText(message)?.trim() || NO_DETAIL_TEXT }];
}

/**
 * Un error de `FEXErr`. Sin codigo (ausente, nulo o ilegible) tambien se cuenta, como en A, B y C; `ErrCode: 0` es "OK".
 */
function toErrorEntry(error: unknown): ExportResponseError[] {
  if (typeof error !== 'object' || error === null) {
    return toTextEntry(error);
  }

  const { ErrCode, ErrMsg } = error as { readonly ErrCode?: unknown; readonly ErrMsg?: unknown };

  if (Number(readResponseText(ErrCode) ?? NaN) === 0) {
    return [];
  }

  const code = readErrorCode(ErrCode);

  return [{ ...(code === undefined ? {} : { code }), message: readResponseText(ErrMsg)?.trim() || NO_DETAIL_TEXT }];
}

/** Un texto donde va un bloque: se muestra, sin codigo. */
function toTextEntry(item: unknown): ExportResponseError[] {
  const message = typeof item === 'object' ? null : readResponseText(item)?.trim();

  return message ? [{ message }] : [];
}

function buildSuggestions(options: {
  readonly messages: string;
  /** Hay CAE y ademas un error: el mensaje del error no esta en `messages`. */
  readonly emittedWithError: boolean;
  readonly status: EmissionStatus;
}): string[] {
  const suggestions = new Set<string>();

  if (/punto de venta/i.test(options.messages)) {
    suggestions.add(POINT_OF_SALE_HINT);
  }

  if (/permiso/i.test(options.messages)) {
    suggestions.add('Revisá los permisos de embarque: van con `--permiso` y `--permiso-existente`.');
  }

  if (/cuit.*(pais|país)/i.test(options.messages)) {
    suggestions.add('Revisá el CUIT del país del cliente (`--cuit-pais`) y el país de destino.');
  }

  if (/moneda|cotizaci[oó]n/i.test(options.messages)) {
    suggestions.add('Revisá la moneda y la cotización (`--moneda`, `--cotizacion-moneda`).');
  }

  if (/incoterm/i.test(options.messages)) {
    suggestions.add('Revisá el incoterm (`--incoterm`): los más comunes son `FOB`, `CIF`, `EXW` y `FCA`.');
  }

  // Proponen otra solicitud: con CAE duplicarian el comprobante.
  const emitted = options.status !== 'rechazado';
  const retry = /actividad|correlativ/i.test(options.messages);

  if (!emitted && /actividad/i.test(options.messages)) {
    suggestions.add(
      'La actividad tiene que estar vinculada al emisor y activa para WSFEX: revisá las actividades habilitadas en ARCA o indicá otra con `--actividad`.',
    );
  }

  if (!emitted && /correlativ/i.test(options.messages)) {
    suggestions.add(
      'Revisá el número del comprobante: tiene que ser el siguiente al último de ese tipo en el punto de venta. Sin `--numero`, ARCLI lo consulta en ARCA; mirá los últimos con `arcli ultimos fe` (o `nce`, `nde`).',
    );
  }

  // Solo el rechazo, como en A/B/C (`billing-response.ts`): una E observada tiene CAE y volver a emitir la duplicaria.
  if (options.status === 'rechazado' && suggestions.size === 0) {
    suggestions.add('Revisá observaciones y errores de ARCA antes de volver a emitir.');
  }

  if (options.emittedWithError) {
    suggestions.add(EMITTED_WITH_ERROR_SUGGESTION);
  } else if (emitted && retry) {
    suggestions.add(EMITTED_WITH_OBSERVATION_SUGGESTION);
  }

  return [...suggestions];
}

export function createDryRunExportResponse(): ExportResponseSummary {
  return {
    cae: null,
    caeVencimiento: null,
    errors: [],
    events: [],
    observacion: null,
    observaciones: [],
    raw: null,
    resultado: null,
    // Sin emision no hay resultado de ARCA: `estado` lo dice, en lugar de un "observado" que no paso.
    status: 'previsualizacion',
    suggestions: [],
  };
}

/** WSFEX informa el rechazo en `Resultado` y los errores duros en `FEXErr`, sin lanzar excepcion. */
export function mapExportResponse(answer: AuthorizationAnswer): ExportResponseSummary {
  // Nada de esto puede costar el CAE: se acepta suelto, en lista, nulo o de otro tipo (ERR-16).
  const errors = asArray<unknown>(answer.errors).flatMap(toErrorEntry);
  const events = asArray(answer.events as RawEvent | RawEvent[] | null | undefined).flatMap((event) => [
    ...toEntry(event?.EventCode, event?.EventMsg),
    ...toTextEntry(event),
  ]);
  const observaciones = asArray<unknown>(answer.observations).flatMap(
    (motivo) => readResponseText(motivo)?.trim() ?? [],
  );
  const resultado = readResponseText(answer.result)?.trim() ?? null;
  const cae = (resultado === 'R' ? readRejectedCae : readCae)(answer.cae);
  const status = resolveEmissionStatus({
    cae,
    errors,
    hasObservations: observaciones.length > 0,
    internalErrors: WSFEX_INTERNAL_ERRORS,
    rejected: resultado === 'R',
    result: resultado,
  });
  const emittedWithError = status !== 'rechazado' && errors.length > 0;
  const messages = [...observaciones, ...(emittedWithError ? [] : errors.map((error) => error.message))].join(' | ');

  return {
    get arcaNumber() {
      return answer.voucherNumber;
    },
    cae,
    caeVencimiento: cae === null ? null : readCaeExpiration(answer.caeExpiration),
    errors,
    events,
    observacion: observaciones.join(' | ') || null,
    observaciones,
    raw: answer.raw,
    resultado,
    status,
    suggestions: buildSuggestions({ emittedWithError, messages, status }),
  };
}
