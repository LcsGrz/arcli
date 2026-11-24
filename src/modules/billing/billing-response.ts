import { asArray } from '../../lib/arrays/as-array';
import type { CreateVoucherResultDto } from '../../services/arca/arca-sdk.types';

import { findArcaRejections, formatArcaRejection } from './arca-rejections';
import type { BillingResponseSummary } from './billing.types.internal';
import { NO_DETAIL_TEXT, readCae, readCaeExpiration, readResponseText } from './emission-response';

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
  const suggestions = buildResponseSuggestions({ errors, observations, resultado });
  const rejected = resultado === 'R';

  return {
    // El SDK devuelve "" en un rechazo; el JSON publico promete null.
    cae: readCae(response.cae) ?? (rejected ? null : readCae(detail?.CAE)),
    caeVencimiento: readCaeExpiration(response.caeFchVto || (rejected ? undefined : detail?.CAEFchVto)),
    errors,
    events,
    observaciones,
    observacion: observaciones.join(' | ') || null,
    raw: response,
    resultado,
    suggestions,
    status: resolveBillingStatus({
      errors,
      observaciones,
      resultado,
    }),
  };
}

/** Lo que no es `{ Code, Msg }` (un texto suelto, un nulo), con la forma que tiene en el JSON. */
function toItem(item: unknown): unknown {
  return typeof item === 'object' && item !== null
    ? item
    : { codigo: null, mensaje: readResponseText(item) ?? NO_DETAIL_TEXT };
}

function readCode(item: unknown): number | undefined {
  const code = typeof item === 'object' && item && 'Code' in item ? Number((item as { Code?: number }).Code) : NaN;

  return Number.isInteger(code) ? code : undefined;
}

function readMessage(item: unknown): string {
  return typeof item === 'object' && item && 'Msg' in item ? (readResponseText(item.Msg) ?? '') : '';
}

/** Lo que sugiere la tabla de rechazos (`arca-rejections.ts`) para los codigos y mensajes de errores y observaciones. */
function buildResponseSuggestions(options: {
  readonly errors: readonly unknown[];
  readonly observations: readonly unknown[];
  readonly resultado: string | null;
}): string[] {
  const items = [...options.errors, ...options.observations];
  const codes = items.map(readCode).filter((code): code is number => code !== undefined);
  const messages = items.map(readMessage).filter(Boolean).join(' | ');
  const suggestions = findArcaRejections(codes, messages).map(formatArcaRejection);

  if (options.resultado === 'R' && suggestions.length === 0) {
    suggestions.push('Revisá observaciones y errores de ARCA antes de volver a emitir.');
  }

  return suggestions;
}

function resolveBillingStatus(options: {
  readonly errors: unknown[];
  readonly observaciones: string[];
  readonly resultado: string | null;
}): BillingResponseSummary['status'] {
  if (options.resultado === 'R' || options.errors.length > 0) {
    return 'rechazado';
  }

  if (options.resultado === 'A' && options.observaciones.length === 0) {
    return 'aprobado';
  }

  return 'observado';
}
