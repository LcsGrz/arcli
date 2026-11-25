import { AppError, HELP_SUGGESTION } from '../../lib/errors/app-error';
import type { ErrorCode } from '../../lib/errors/error-codes';
import { summarizeError } from '../../lib/errors/error-summary';
import { serializeError } from '../../lib/errors/serialize-error';
import { ISSUES_URL } from '../../lib/links';
import { shortenPath } from '../../lib/paths/mask-path';
import { normalizeSearchText } from '../../lib/text/search';
import { errorPanel } from '../components/errorPanel';
import { bold } from '../primitives/text';

/** Los que no estan se titulan "Error". */
const ERROR_TITLES: Readonly<Partial<Record<ErrorCode, string>>> = {
  BATCH_EMISSION_ERROR: 'Lote interrumpido',
  BATCH_VALIDATION_ERROR: 'Lote inválido',
  CANCELLED: 'Emisión cancelada',
  CERTIFICATE_EXPIRED: 'Certificado vencido',
  CONFIGURATION_ERROR: 'Error de configuración',
  EMISSION_UNCERTAIN: 'Emisión sin confirmar',
  INPUT_VALIDATION_ERROR: 'Error de entrada',
  PDF_GENERATION_ERROR: 'PDF no generado',
  PDF_ISSUER_INCOMPLETE: 'PDF no generado',
  PDF_PLUGIN_INSTALL_ERROR: 'Plugin de PDF no instalado',
  PDF_PLUGIN_MISSING: 'PDF no generado',
};

/** La sugerencia del panel para los errores que no traen la suya. */
const ERROR_HINTS: Readonly<Partial<Record<ErrorCode, string>>> = {
  BATCH_VALIDATION_ERROR: 'Corregí esos comprobantes en el archivo y volvé a correr el lote completo.',
  CONFIGURATION_ERROR: 'Revisá la configuración con `arcli config` o corré `arcli config revisar`.',
  INPUT_VALIDATION_ERROR: HELP_SUGGESTION,
};

function formatErrorHint(error: AppError): string | null {
  return error.suggestion || (ERROR_HINTS[error.code] ?? null);
}

/** Lo que dicen Node y los clientes HTTP cuando no hubo conexion o se corto. */
const NETWORK_ERROR =
  /\b(?:EAI_AGAIN|ECONNABORTED|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|ETIMEDOUT)\b|socket hang up|fetch failed/;

function formatUnexpectedErrorHint(message: string): string {
  return NETWORK_ERROR.test(message)
    ? 'Revisá tu conexión a internet y probá de nuevo en unos minutos. Con `arcli estado` ves si ARCA responde.'
    : `Si el problema persiste, revisá la configuración con \`arcli config revisar\` o avisanos en ${ISSUES_URL}.`;
}

const TRANSIENT_ERROR_TITLES = {
  arca: 'Error transitorio ARCA',
  wsaa: 'Error transitorio WSAA',
} as const;

/** Como se lee cada clave de `detalles` en el panel; el JSON no cambia. */
const DETAIL_LABELS: Readonly<Record<string, string>> = {
  causa: 'Causa',
  cause: 'Causa',
  entorno: 'Entorno',
  idSolicitud: 'Solicitud',
  path: 'Ruta',
  salida: 'Salida',
  vencimiento: 'Vencimiento',
};

/** Datos para quien lee el JSON: en el panel ya los dicen el mensaje y la sugerencia. */
const JSON_ONLY_DETAILS: ReadonlySet<string> = new Set(['codigoCausa']);

/** Los que son solo para el JSON en un codigo y en otros se muestran. */
const JSON_ONLY_DETAILS_BY_CODE: Readonly<Partial<Record<ErrorCode, ReadonlySet<string>>>> = {
  BATCH_EMISSION_ERROR: new Set(['numero']),
  EMISSION_UNCERTAIN: new Set(['entorno', 'numero', 'puntoVenta', 'tipoArca']),
};

/** Si el texto ya trae el valor, entero: un `7` no cuenta como dicho por un `17`. */
function alreadySaid(text: string, value: unknown): boolean {
  const target = normalizeSearchText(String(value)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return new RegExp(`(?<![\\p{L}\\p{N}])${target}(?![\\p{L}\\p{N}])`, 'u').test(normalizeSearchText(text));
}

/** Los detalles que el panel suma: sin repetir lo que ya dicen el mensaje o la sugerencia. */
function formatErrorDetails({ code, details }: AppError, said: string): string[] {
  if (!details) {
    return [];
  }

  // Arrays y objetos (por ejemplo, la lista de items de un lote) solo van en el JSON:
  // en texto se verian como "[object Object]" y ya estan en el mensaje.
  return Object.entries(details)
    .filter(([key]) => !JSON_ONLY_DETAILS.has(key) && !JSON_ONLY_DETAILS_BY_CODE[code]?.has(key))
    .filter(([, value]) => value !== null && value !== undefined && value !== '' && typeof value !== 'object')
    .filter(
      ([key, value]) =>
        !alreadySaid(said, key === 'path' ? shortenPath(String(value)) : value) && !alreadySaid(said, value),
    )
    .map(([key, value]) => `${bold(`${DETAIL_LABELS[key] ?? key}:`)} ${String(value)}`);
}

/** Un error de la app o inesperado. Los de un esquema (zod) los describe el dominio: ver `formatInputIssues`. */
export function formatAppError(error: unknown): string {
  if (error instanceof AppError) {
    const hint = formatErrorHint(error);
    const details = formatErrorDetails(error, `${error.message}\n${hint ?? ''}`);

    return errorPanel(ERROR_TITLES[error.code] ?? 'Error', error.message, details, hint ?? undefined);
  }

  const { error: message, sugerencia } = serializeError(error);
  const { transient } = summarizeError(error);

  return errorPanel(
    transient ? TRANSIENT_ERROR_TITLES[transient] : 'Error inesperado',
    message,
    [],
    sugerencia ?? formatUnexpectedErrorHint(message),
  );
}
