import type { IFEXAuthorizeOutput } from '@arcasdk/core/lib/application/dto/fex';

import type { ExportResponseError, ExportResponseSummary } from './export.types';

const POINT_OF_SALE_HINT = 'Revisá los puntos de venta habilitados para WSFEX con `arcli parametros puntos-venta`.';

function normalizeArcaDate(value: string | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '').slice(0, 8);

  return /^\d{8}$/.test(digits) ? digits : null;
}

/**
 * WSFEX informa los errores en `FEXErr` y los avisos en `FEXEvents`, con el codigo en 0 cuando no hay nada que
 * decir: en la autorizacion exitosa manda `ErrCode: 0` con `ErrMsg: "OK"`, que no es un error.
 */
function toEntry(code: number | undefined, message: string | undefined): ExportResponseError[] {
  if (!code) {
    return [];
  }

  return [{ code, message: message?.trim() || 'ARCA no informó el detalle.' }];
}

function buildSuggestions(options: {
  readonly messages: string;
  readonly status: 'aprobado' | 'observado' | 'rechazado';
}): string[] {
  const suggestions = new Set<string>();

  if (/punto de venta/i.test(options.messages)) {
    suggestions.add(POINT_OF_SALE_HINT);
  }

  if (/permiso/i.test(options.messages)) {
    suggestions.add('Revisá los permisos de embarque: van con --permiso y --permiso-existente.');
  }

  if (/cuit.*(pais|país)/i.test(options.messages)) {
    suggestions.add('Revisá el CUIT del país del cliente (`--cuit-pais`) y el país de destino.');
  }

  if (/moneda|cotizaci[oó]n/i.test(options.messages)) {
    suggestions.add('Revisá la moneda y la cotización (`--moneda`, `--cotizacion-moneda`).');
  }

  if (/incoterm/i.test(options.messages)) {
    suggestions.add('Revisá el incoterm (`--incoterm`) contra la tabla de ARCA.');
  }

  if (/actividad/i.test(options.messages)) {
    suggestions.add(
      'La actividad tiene que estar vinculada al emisor y activa para WSFEX: revisá las actividades habilitadas en ARCA o indicá otra con --actividad.',
    );
  }

  if (/correlativ/i.test(options.messages)) {
    suggestions.add(
      'Revisá el número del comprobante (--numero): tiene que ser el siguiente al último E emitido en ese punto de venta.',
    );
  }

  if (options.status !== 'aprobado' && suggestions.size === 0) {
    suggestions.add('Revisá observaciones y errores de ARCA antes de volver a emitir.');
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
    status: 'observado',
    suggestions: [],
  };
}

/** WSFEX informa el rechazo en `Resultado` y los errores duros en `FEXErr`, sin lanzar excepcion. */
export function mapExportResponse(output: IFEXAuthorizeOutput): ExportResponseSummary {
  const result = output.FEXAuthorizeResult;
  const authorization = result?.FEXResultAuth;
  const errors = toEntry(result?.FEXErr?.ErrCode, result?.FEXErr?.ErrMsg);
  const events = toEntry(result?.FEXEvents?.EventCode, result?.FEXEvents?.EventMsg);
  const motivo = authorization?.Motivos_Obs?.trim();
  const observaciones = motivo ? [motivo] : [];
  const resultado = authorization?.Resultado?.trim() || null;
  const cae = authorization?.Cae?.trim() || null;
  const status =
    resultado === 'R' || errors.length > 0
      ? 'rechazado'
      : resultado === 'A' && observaciones.length === 0
        ? 'aprobado'
        : 'observado';
  const messages = [...observaciones, ...errors.map((error) => error.message)].join(' | ');

  return {
    cae,
    caeVencimiento: normalizeArcaDate(authorization?.Fch_venc_Cae),
    errors,
    events,
    observacion: observaciones.join(' | ') || null,
    observaciones,
    raw: output,
    resultado,
    status,
    suggestions: buildSuggestions({ messages, status }),
  };
}
