import type { BillingExecutionResult } from './billing.types.internal';

interface BillingSerializeOptions {
  readonly raw?: boolean;
}

function formatRawResponse(
  result: BillingExecutionResult,
): Record<string, string> | NonNullable<BillingExecutionResult['response']['raw']> {
  if (result.response.raw) {
    return result.response.raw;
  }

  return {
    mensaje: 'Sin emision real. Use --emitir para obtener una respuesta de ARCA.',
  };
}

function formatVoucherSummary(result: BillingExecutionResult): Record<string, unknown> {
  return {
    atajo: result.voucherKind.shortcut,
    cae: result.response.cae,
    caeVencimiento: result.response.caeVencimiento,
    comprobante: result.voucherKind.displayName,
    errores: result.response.errors,
    estado: result.response.status,
    eventos: result.response.events,
    observaciones: result.response.observaciones,
    observacion: result.response.observacion,
    solicitud: result.payload,
    previsualizacion: result.dryRun,
    resultado: result.response.resultado,
    sugerencias: result.response.suggestions,
    tipoArca: result.voucherKind.arcaType,
  };
}

export function serializeBillingResult(
  result: BillingExecutionResult,
  options: BillingSerializeOptions = {},
): Record<string, unknown> {
  if (options.raw) {
    return {
      atajo: result.voucherKind.shortcut,
      comprobante: result.voucherKind.displayName,
      solicitud: result.payload,
      previsualizacion: result.dryRun,
      respuesta: formatRawResponse(result),
      sugerencias: result.response.suggestions,
    };
  }

  return formatVoucherSummary(result);
}

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

export function formatRawBillingResponse(
  result: BillingExecutionResult,
): Record<string, string> | NonNullable<BillingExecutionResult['response']['raw']> {
  return formatRawResponse(result);
}
