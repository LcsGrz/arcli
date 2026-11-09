import type { CreateVoucherResultDto } from '../../services/arca/arca-sdk.types';

import { findArcaRejections, formatArcaRejection } from './arca-rejections';
import type { BillingResponseSummary } from './billing.types.internal';

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

export function mapBillingResponse(response: CreateVoucherResultDto): BillingResponseSummary {
  const detail = response.response?.FeDetResp?.FECAEDetResponse?.[0];
  const events = response.response?.Events?.Evt ?? [];
  const errors = response.response?.Errors?.Err ?? [];
  const observaciones =
    detail?.Observaciones?.Obs?.map((item) => item.Msg).filter((msg): msg is string => Boolean(msg)) ?? [];
  const resultado = detail?.Resultado ?? null;
  const suggestions = buildResponseSuggestions({
    errors,
    observations: detail?.Observaciones?.Obs ?? [],
    resultado,
  });

  return {
    // El SDK devuelve "" en un rechazo; el JSON publico promete null.
    cae: response.cae || null,
    caeVencimiento: response.caeFchVto || null,
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

function readCode(item: unknown): number | undefined {
  const code = typeof item === 'object' && item && 'Code' in item ? Number((item as { Code?: number }).Code) : NaN;

  return Number.isInteger(code) ? code : undefined;
}

function readMessage(item: unknown): string {
  return typeof item === 'object' && item && 'Msg' in item ? String((item as { Msg?: string }).Msg ?? '') : '';
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
