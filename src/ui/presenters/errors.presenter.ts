import { AppError, HELP_SUGGESTION } from '../../lib/errors/app-error';
import { isQueryError, VERIFY_BEFORE_RETRY } from '../../lib/errors/query-error';
import { ISSUES_URL } from '../../lib/links';
import { shortenPath } from '../../lib/paths/mask-path';
import { normalizeSearchText } from '../../lib/text/search';
import { errorPanel } from '../components/errorPanel';
import { renderJson } from '../primitives/renderJson';
import { bold } from '../primitives/text';

function formatErrorTitle(code: string): string {
  switch (code) {
    case 'CONFIGURATION_ERROR':
      return 'Error de configuración';
    case 'CERTIFICATE_EXPIRED':
      return 'Certificado vencido';
    case 'INPUT_VALIDATION_ERROR':
      return 'Error de entrada';
    case 'BATCH_VALIDATION_ERROR':
      return 'Lote inválido';
    case 'BATCH_EMISSION_ERROR':
      return 'Lote interrumpido';
    case 'EMISSION_UNCERTAIN':
      return 'Emisión sin confirmar';
    case 'PDF_GENERATION_ERROR':
    case 'PDF_ISSUER_INCOMPLETE':
    case 'PDF_PLUGIN_MISSING':
      return 'PDF no generado';
    case 'PDF_PLUGIN_INSTALL_ERROR':
      return 'Plugin de PDF no instalado';
    default:
      return 'Error';
  }
}

/**
 * Que hacer con un lote cortado. Los procesados pueden incluir rechazados, que no se emitieron: manda el CAE. Con uno
 * sin confirmar, el mensaje ya trae el comando para verificarlo; sin eso, fallo antes de la llamada que emite (ERR-16).
 */
function formatInterruptedBatchHint(details: Record<string, unknown> = {}): string | null {
  const { fallo, procesados, sinConfirmar, sinProcesar } = details;
  const uncertain = sinConfirmar !== undefined;
  const pending = Array.isArray(sinProcesar) && sinProcesar.length > 0;
  const steps = [
    ...(procesados ? ['Los procesados con CAE ya se emitieron: no los vuelvas a cargar.'] : []),
    ...(!uncertain && fallo !== undefined ? [`El #${String(fallo)} no se emitió.`] : []),
    ...(pending ? [`${uncertain ? 'Después reintentá' : 'Reintentá'} los que quedaron sin procesar.`] : []),
  ];

  return steps.length > 0 ? steps.join(' ') : null;
}

function formatErrorHint(error: AppError): string | null {
  if (error.suggestion) {
    return error.suggestion;
  }

  switch (error.code) {
    case 'CONFIGURATION_ERROR':
      return 'Revisá la configuración con `arcli config` o corré `arcli config revisar`.';
    case 'INPUT_VALIDATION_ERROR':
      return HELP_SUGGESTION;
    case 'BATCH_VALIDATION_ERROR':
      return 'Corregí esos comprobantes en el archivo y volvé a correr el lote completo.';
    case 'BATCH_EMISSION_ERROR':
      return formatInterruptedBatchHint(error.details);
    default:
      return null;
  }
}

/** Lo que dicen Node y los clientes HTTP cuando no hubo conexion o se corto. */
const NETWORK_ERROR =
  /\b(?:EAI_AGAIN|ECONNABORTED|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|ETIMEDOUT)\b|socket hang up|fetch failed/;

function formatUnexpectedErrorHint(message: string): string {
  return NETWORK_ERROR.test(message)
    ? 'Revisá tu conexión a internet y probá de nuevo en unos minutos. Con `arcli estado` ves si ARCA responde.'
    : `Si el problema persiste, revisá la configuración con \`arcli config revisar\` o avisanos en ${ISSUES_URL}.`;
}

function detectTransientError(
  message: string,
  query: boolean,
): {
  readonly sugerencia: string;
  readonly title: string;
} | null {
  if (message.includes('coe.alreadyAuthenticated')) {
    return {
      sugerencia: `ARCA todavía tiene abierta una sesión anterior. Esperá un par de minutos y ${query ? `repetí la consulta. ${VERIFY_BEFORE_RETRY}` : 'probá de nuevo, con los mismos datos.'}`,
      title: 'Error transitorio WSAA',
    };
  }

  if (message.includes('Transacción Activa')) {
    return {
      sugerencia: `ARCA devolvió una transacción activa. Esperá unos segundos y ${query ? `repetí la consulta. ${VERIFY_BEFORE_RETRY}` : 'reintentá la emisión antes de modificar datos del comprobante.'}`,
      title: 'Error transitorio ARCA',
    };
  }

  return null;
}

/** Como se lee cada clave de `detalles` en el panel; el JSON no cambia. */
const DETAIL_LABELS: Readonly<Record<string, string>> = {
  causa: 'Causa',
  cause: 'Causa',
  entorno: 'Entorno',
  idSolicitud: 'Solicitud',
  numero: 'Número',
  path: 'Ruta',
  salida: 'Salida',
  vencimiento: 'Vencimiento',
};

/** Si el texto ya trae el valor, entero: un `7` no cuenta como dicho por un `17`. */
function alreadySaid(text: string, value: unknown): boolean {
  const target = normalizeSearchText(String(value)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return new RegExp(`(?<![\\p{L}\\p{N}])${target}(?![\\p{L}\\p{N}])`, 'u').test(normalizeSearchText(text));
}

/** Los detalles que el panel suma: sin repetir lo que ya dicen el mensaje o la sugerencia. */
function formatErrorDetails(details: Record<string, unknown> | undefined, said: string): string[] {
  if (!details) {
    return [];
  }

  // Arrays y objetos (por ejemplo, la lista de items de un lote) solo van en el JSON:
  // en texto se verian como "[object Object]" y ya estan en el mensaje.
  return Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== '' && typeof value !== 'object')
    .filter(
      ([key, value]) =>
        !alreadySaid(said, key === 'path' ? shortenPath(String(value)) : value) && !alreadySaid(said, value),
    )
    .map(([key, value]) => `${bold(`${DETAIL_LABELS[key] ?? key}:`)} ${String(value)}`);
}

function formatErrorDetailsAsJson(details: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!details) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(details)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => [key === 'path' ? 'ruta' : key, value]),
  );
}

/** Un error de la app o inesperado. Los de un esquema (zod) los describe el dominio: ver `formatInputIssues`. */
export function formatAppError(error: unknown, useJson: boolean): string {
  if (error instanceof AppError) {
    if (useJson) {
      return renderJson({
        codigo: error.code,
        detalles: formatErrorDetailsAsJson(error.details),
        error: error.message,
        // Siempre presente: `null` cuando no hay que sugerir, igual que en los errores inesperados.
        sugerencia: error.suggestion ?? null,
      });
    }

    const hint = formatErrorHint(error);
    const details = formatErrorDetails(error.details, `${error.message}\n${hint ?? ''}`);
    return errorPanel(formatErrorTitle(error.code), error.message, details, hint ?? undefined);
  }

  const message = error instanceof Error ? error.message : 'Ocurrió un error inesperado.';
  const transientError = detectTransientError(message, isQueryError(error));

  if (useJson) {
    return renderJson({
      codigo: transientError ? 'TRANSIENT_ERROR' : 'UNEXPECTED_ERROR',
      detalles: null,
      error: message,
      sugerencia: transientError?.sugerencia ?? null,
    });
  }

  return errorPanel(
    transientError?.title ?? 'Error inesperado',
    message,
    [],
    transientError?.sugerencia ?? formatUnexpectedErrorHint(message),
  );
}
