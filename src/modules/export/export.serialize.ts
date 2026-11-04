import type { ExportExecutionResult } from './export.types';

export interface ExportSerializeOptions {
  readonly raw?: boolean;
}

// Aditivo: la clave `pdf` solo aparece si se intento generar el PDF.
function formatPdfOutcome(result: ExportExecutionResult): Record<string, unknown> {
  if (!result.pdf) {
    return {};
  }

  if ('path' in result.pdf) {
    return { pdf: { ruta: result.pdf.path } };
  }

  const { code, message, suggestion } = result.pdf.error;

  return { pdf: { error: { codigo: code, mensaje: message, sugerencia: suggestion ?? null } } };
}

function formatRawResponse(result: ExportExecutionResult): unknown {
  return result.response.raw ?? { mensaje: 'Sin emisión real. Usá --emitir para obtener una respuesta de ARCA.' };
}

/** Lo que WSFEX tiene y wsfe no: destino, incoterm, permisos e items reales. */
function formatExportBlock(result: ExportExecutionResult): Record<string, unknown> {
  const { payload, display } = result;

  return {
    actividad: payload.Actividades.Actividad.map((activity) => activity.Id),
    cliente: payload.Cliente,
    cuitPaisCliente: payload.Cuit_pais_cliente,
    destino: { codigo: payload.Dst_cmp, nombre: display.countryName ?? null },
    domicilioCliente: payload.Domicilio_cliente,
    formaPago: payload.Forma_pago,
    idImpositivo: payload.Id_impositivo || null,
    idioma: payload.Idioma_cbte,
    incoterm: payload.Incoterms || null,
    incotermDescripcion: payload.Incoterms_Ds || null,
    items: payload.Items.Item.map((item) => ({
      cantidad: item.Pro_qty,
      codigo: item.Pro_codigo || null,
      descripcion: item.Pro_ds,
      precioUnitario: item.Pro_precio_uni,
      total: item.Pro_total_item,
      unidad: display.unitNames[item.Pro_umed] ?? null,
      unidadCodigo: item.Pro_umed,
    })),
    mismaMoneda: payload.CanMisMonExt === 'S',
    permisos: payload.Permisos?.Permiso ?? [],
    tipoExpo: payload.Tipo_expo,
  };
}

export function serializeExportResult(
  result: ExportExecutionResult,
  options: ExportSerializeOptions = {},
): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    atajo: result.voucherKind.shortcut,
    avisos: result.warnings ?? [],
    cae: result.response.cae,
    caeVencimiento: result.response.caeVencimiento,
    comprobante: result.voucherKind.displayName,
    errores: result.response.errors,
    estado: result.response.status,
    eventos: result.response.events,
    exportacion: formatExportBlock(result),
    observaciones: result.response.observaciones,
    observacion: result.response.observacion,
    ...formatPdfOutcome(result),
    previsualizacion: result.dryRun,
    resultado: result.response.resultado,
    solicitud: result.payload,
    sugerencias: result.response.suggestions,
    tipoArca: result.voucherKind.arcaType,
  };

  return options.raw ? { ...summary, respuesta: formatRawResponse(result) } : summary;
}

export function formatExportResultAsJson(result: ExportExecutionResult, options: ExportSerializeOptions = {}): string {
  return JSON.stringify(serializeExportResult(result, options), null, 2);
}

export function formatRawExportResponse(result: ExportExecutionResult): unknown {
  return formatRawResponse(result);
}
