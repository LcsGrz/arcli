import { asArray } from '../../lib/arrays/as-array';
import type { CreateVoucherResultDto } from '../../services/arca/arca-sdk.types';

import { findArcaRejections, formatArcaRejection } from './arca-rejections';
import type { BillingResponseSummary } from './billing.types.internal';
import {
  EMITTED_WITH_ERROR_SUGGESTION,
  NO_DETAIL_TEXT,
  readCae,
  readCaeExpiration,
  readErrorCode,
  readRejectedCae,
  readResponseText,
  resolveEmissionStatus,
  WSFE_INTERNAL_ERRORS,
} from './emission-response';

export function createDryRunResponse(): BillingResponseSummary {
  return {
    cae: null,
    caeVencimiento: null,
    errors: [],
    events: [],
    observaciones: [],
    observacion: null,
    raw: null,
    resultado: null,
    suggestions: [],
    // Sin emision no hay resultado de ARCA: `estado` lo dice, en lugar de un "observado" que no paso.
    status: 'previsualizacion',
  };
}

interface RawDetail {
  readonly CAE?: unknown;
  readonly CAEFchVto?: unknown;
  readonly Observaciones?: { readonly Obs?: unknown } | null;
  readonly Resultado?: unknown;
}

/** El detalle del comprobante. El SDK solo mira el primero de una lista: con un objeto suelto pierde el CAE. */
function readDetail(response: CreateVoucherResultDto): RawDetail | undefined {
  return asArray<unknown>(response.response?.FeDetResp?.FECAEDetResponse)[0] as RawDetail | undefined;
}

export function mapBillingResponse(response: CreateVoucherResultDto): BillingResponseSummary {
  const detail = readDetail(response);
  // Nada de esto puede costar el CAE: se acepta suelto, en lista, nulo o de otro tipo (ERR-16).
  const events = asArray<unknown>(response.response?.Events?.Evt)
    .filter((item) => item !== null)
    .map(toItem);
  // Uno nulo tambien cuenta: ARCA informo un error, aunque no se lea.
  const errors = asArray<unknown>(response.response?.Errors?.Err).map(toItem);
  const observations = asArray<unknown>(detail?.Observaciones?.Obs);
  const observaciones = observations.map(readMessage).filter(Boolean);
  const resultado = readResponseText(detail?.Resultado);
  // Sin el resultado del comprobante vale el de la cabecera, que con uno solo es el mismo; con CAE, no: manda el CAE.
  const rejectedByHeader = resultado === null && readResponseText(response.response?.FeCabResp?.Resultado) === 'R';
  // El SDK solo devuelve el CAE con `A`; el JSON publico promete null.
  const readAnswerCae = resultado === 'R' || rejectedByHeader ? readRejectedCae : readCae;
  const cae = readAnswerCae(response.cae) ?? readAnswerCae(detail?.CAE);
  const status = resolveEmissionStatus({
    cae,
    errors: errors.map((item) => ({ code: readCode(item), message: readMessage(item) || readText(item) })),
    hasObservations: observaciones.length > 0,
    internalErrors: WSFE_INTERNAL_ERRORS,
    rejected: resultado === 'R' || (rejectedByHeader && cae === null),
    result: resultado,
  });

  return {
    cae,
    caeVencimiento: readCaeExpiration(response.caeFchVto || (cae === null ? undefined : detail?.CAEFchVto)),
    errors,
    events,
    observaciones,
    observacion: observaciones.join(' | ') || null,
    raw: response,
    resultado,
    suggestions: buildResponseSuggestions({ emitted: status !== 'rechazado', errors, observations }),
    status,
  };
}

/** Lo que no es `{ Code, Msg }` (un texto suelto, un nulo), con la forma que tiene en el JSON. */
function toItem(item: unknown): unknown {
  return typeof item === 'object' && item !== null
    ? item
    : { codigo: null, mensaje: readResponseText(item) ?? NO_DETAIL_TEXT };
}

function readCode(item: unknown): number | undefined {
  return typeof item === 'object' && item && 'Code' in item ? readErrorCode(item.Code) : undefined;
}

function readMessage(item: unknown): string {
  return typeof item === 'object' && item && 'Msg' in item ? (readResponseText(item.Msg) ?? '') : '';
}

/** El texto de un error que no vino como `{ Code, Msg }` (ver `toItem`). */
function readText(item: unknown): string {
  return typeof item === 'object' && item && 'mensaje' in item ? (readResponseText(item.mensaje) ?? '') : '';
}

/** Lo que sugiere la tabla de rechazos (`arca-rejections.ts`) para los codigos y mensajes de errores y observaciones. */
function buildResponseSuggestions(options: {
  readonly emitted: boolean;
  readonly errors: readonly unknown[];
  readonly observations: readonly unknown[];
}): string[] {
  const emittedWithError = options.emitted && options.errors.length > 0;
  const items = emittedWithError ? options.observations : [...options.errors, ...options.observations];
  const codes = items.map(readCode).filter((code): code is number => code !== undefined);
  const messages = items.map(readMessage).filter(Boolean).join(' | ');
  const suggestions = findArcaRejections(codes, messages).map(formatArcaRejection);

  if (!options.emitted && suggestions.length === 0) {
    suggestions.push('Revisá observaciones y errores de ARCA antes de volver a emitir.');
  }

  return emittedWithError ? [...suggestions, EMITTED_WITH_ERROR_SUGGESTION] : suggestions;
}
