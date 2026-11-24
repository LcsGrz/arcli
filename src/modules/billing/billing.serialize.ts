import { DEPRECATED_BILLING_RESPONSE_KEYS } from '../../lib/json/deprecations';
import { serializePdfOutcome } from '../pdf/pdf.serialize';

import type { BillingExecutionResult } from './billing.types.internal';

interface BillingSerializeOptions {
  readonly raw?: boolean;
}

export function formatRawResponse(result: BillingExecutionResult): unknown {
  if (result.response.raw) {
    return result.response.raw;
  }

  return {
    mensaje: 'Sin emisión real. Usá `--emitir` para obtener una respuesta de ARCA.',
  };
}

/** ARCA informa `Code` y `Msg`: se suman `codigo` y `mensaje`, como en el resto del JSON. */
function withSpanishKeys(item: unknown): unknown {
  // Los que no vinieron como `{ Code, Msg }` ya tienen las claves en castellano.
  if (typeof item !== 'object' || item === null || 'mensaje' in item) {
    return item;
  }

  const { Code, Msg } = item as { readonly Code?: unknown; readonly Msg?: unknown };

  return { ...item, codigo: Code, mensaje: Msg };
}

function formatVoucherSummary(result: BillingExecutionResult): Record<string, unknown> {
  const { errors, events } = result.response;

  return {
    atajo: result.voucherKind.shortcut,
    avisos: result.warnings ?? [],
    cae: result.response.cae,
    caeVencimiento: result.response.caeVencimiento,
    comprobante: result.voucherKind.displayName,
    ...(errors.length + events.length > 0 ? { deprecado: [DEPRECATED_BILLING_RESPONSE_KEYS] } : {}),
    entorno: result.environment,
    errores: errors.map(withSpanishKeys),
    estado: result.response.status,
    eventos: events.map(withSpanishKeys),
    observaciones: result.response.observaciones,
    observacion: result.response.observacion,
    numero: result.voucherNumber ?? null,
    puntoVenta: result.payload.PtoVta,
    ...serializePdfOutcome(result.pdf),
    // Lo que se envio a ARCA, con el numero que le toco.
    solicitud:
      result.voucherNumber === undefined
        ? result.payload
        : { ...result.payload, CbteDesde: result.voucherNumber, CbteHasta: result.voucherNumber },
    previsualizacion: result.dryRun,
    resultado: result.response.resultado,
    sugerencias: result.response.suggestions,
    tipoArca: result.voucherKind.arcaType,
  };
}

/** `--bruto` suma `respuesta` (la respuesta cruda de ARCA) al resumen de siempre; no le quita campos. */
export function serializeBillingResult(
  result: BillingExecutionResult,
  options: BillingSerializeOptions = {},
): Record<string, unknown> {
  const summary = formatVoucherSummary(result);

  if (!options.raw) {
    return summary;
  }

  return { ...summary, respuesta: formatRawResponse(result) };
}

/** @internal Exportado para los tests. */
export function serializeBillingBatch(
  results: BillingExecutionResult[],
  options: BillingSerializeOptions = {},
): Array<Record<string, unknown>> {
  return results.map((result, index) => ({
    atajo: result.voucherKind.shortcut,
    indice: index + 1,
    comprobante: result.voucherKind.displayName,
    ...serializeBillingResult(result, options),
  }));
}

/**
 * La salida `--json` de una facturacion. `batch`: entro un array en `--cargar`, y sale como array aunque tenga un solo
 * resultado.
 */
export function serializeBillingOutput(
  results: BillingExecutionResult[],
  { batch, raw }: BillingSerializeOptions & { readonly batch?: boolean },
): Record<string, unknown> | Array<Record<string, unknown>> {
  const [result] = results;

  return result && results.length === 1 && !batch
    ? serializeBillingResult(result, { raw })
    : serializeBillingBatch(results, { raw });
}
