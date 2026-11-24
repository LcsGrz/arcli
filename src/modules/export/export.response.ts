import { asArray } from '../../lib/arrays/as-array';
import type { IFEXAuthorizeOutput } from '../../services/arca/arca-sdk.types';
import { readCae, readCaeExpiration, readResponseText } from '../billing/emission-response';

import type { ExportResponseError, ExportResponseSummary } from './export.types';

const NO_DETAIL = 'ARCA no informó el detalle.';
const POINT_OF_SALE_HINT = 'Revisá los puntos de venta habilitados para WSFEX con `arcli parametros puntos-venta`.';

/**
 * WSFEX informa los errores en `FEXErr` y los avisos en `FEXEvents`, con el codigo en 0 cuando no hay nada que
 * decir: en la autorizacion exitosa manda `ErrCode: 0` con `ErrMsg: "OK"`, que no es un error.
 */
function toEntry(code: number | undefined, message: unknown): ExportResponseError[] {
  if (!code) {
    return [];
  }

  return [{ code, message: readResponseText(message)?.trim() || NO_DETAIL }];
}

function buildSuggestions(options: {
  readonly messages: string;
  readonly status: 'aprobado' | 'observado' | 'previsualizacion' | 'rechazado';
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
    suggestions.add('Revisá el incoterm (`--incoterm`) contra la tabla de ARCA.');
  }

  if (/actividad/i.test(options.messages)) {
    suggestions.add(
      'La actividad tiene que estar vinculada al emisor y activa para WSFEX: revisá las actividades habilitadas en ARCA o indicá otra con `--actividad`.',
    );
  }

  if (/correlativ/i.test(options.messages)) {
    suggestions.add(
      'Revisá el número del comprobante: tiene que ser el siguiente al último de ese tipo en el punto de venta. Sin `--numero`, ARCLI lo consulta en ARCA; mirá los últimos con `arcli ultimos fe`.',
    );
  }

  // Solo el rechazo, como en A/B/C (`billing-response.ts`): una E observada tiene CAE y volver a emitir la duplicaria.
  if (options.status === 'rechazado' && suggestions.size === 0) {
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
    // Sin emision no hay resultado de ARCA: `estado` lo dice, en lugar de un "observado" que no paso.
    status: 'previsualizacion',
    suggestions: [],
  };
}

/** WSFEX informa el rechazo en `Resultado` y los errores duros en `FEXErr`, sin lanzar excepcion. */
export function mapExportResponse(output: IFEXAuthorizeOutput): ExportResponseSummary {
  const result = output.FEXAuthorizeResult;
  const authorization = asArray(result?.FEXResultAuth)[0];
  // Nada de esto puede costar el CAE: se acepta suelto, en lista, nulo o de otro tipo (ERR-16).
  const errors = asArray(result?.FEXErr).flatMap((error) => toEntry(error?.ErrCode, error?.ErrMsg));
  const events = asArray(result?.FEXEvents).flatMap((event) => toEntry(event?.EventCode, event?.EventMsg));
  const observaciones = asArray<unknown>(authorization?.Motivos_Obs).flatMap(
    (motivo) => readResponseText(motivo)?.trim() ?? [],
  );
  const resultado = readResponseText(authorization?.Resultado)?.trim() ?? null;
  // En un rechazo no hay CAE, venga lo que venga en su lugar.
  const cae = resultado === 'R' ? (readResponseText(authorization?.Cae)?.trim() ?? null) : readCae(authorization?.Cae);
  const status =
    resultado === 'R' || errors.length > 0
      ? 'rechazado'
      : resultado === 'A' && observaciones.length === 0
        ? 'aprobado'
        : 'observado';
  const messages = [...observaciones, ...errors.map((error) => error.message)].join(' | ');

  return {
    cae,
    caeVencimiento: readCaeExpiration(authorization?.Fch_venc_Cae),
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
