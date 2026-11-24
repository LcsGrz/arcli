import { AppError } from '../../lib/errors/app-error';
import type { ErrorCode } from '../../lib/errors/error-codes';
import { describeFileError, errorText } from '../../lib/files/file-error';

/** Lo que devolvio una tabla de WSFEX o, si la consulta fallo, por que. */
export type ExportTable<T> =
  | { readonly error: unknown; readonly ok: false; readonly rows: readonly T[] }
  | { readonly ok: true; readonly rows: readonly T[] };

const ACCESS_ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'CERTIFICATE_EXPIRED',
  'CERTIFICATE_INVALID',
  'CONFIGURATION_ERROR',
  'WSFEX_SERVICE_NOT_AUTHORIZED',
]);

/**
 * Los errores de WSAA (`cms.cert.expired`, `coe.alreadyAuthenticated`, `wsaa.unavailable`…) y el de WSFEX con un token
 * que no vale ("Usuario no autorizado a realizar esta operación. ValidacionDeToken…").
 */
const ACCESS_ERROR_TEXT = /\b(?:cms|coe|wsaa|wsn|xml)\.[a-z]|ValidacionDeToken|usuario no autorizado/i;

/** El permiso, el certificado o la carpeta de tickets: con eso no se emite, asi que la vista previa tiene que cortar. */
function isAccessError(error: unknown): boolean {
  return (
    (error instanceof AppError && ACCESS_ERROR_CODES.has(error.code)) ||
    describeFileError(error) !== undefined ||
    (error instanceof Error && ACCESS_ERROR_TEXT.test(error.message))
  );
}

/**
 * Una tabla auxiliar de WSFEX: si no responde, la vista previa sigue sin ella y avisa (EXPO-13), salvo que de ella
 * salga un dato que se emite (`requireExportTable`). Los errores de acceso cortan.
 */
export async function readExportTable<T>(read: () => Promise<readonly T[]>): Promise<ExportTable<T>> {
  try {
    return { ok: true, rows: await read() };
  } catch (error) {
    if (isAccessError(error)) {
      throw error;
    }

    return { error, ok: false, rows: [] };
  }
}

/** Las filas de una tabla que hace falta para emitir: si fallo, sale su error. */
export function requireExportTable<T>(table: ExportTable<T>): readonly T[] {
  if (!table.ok) {
    throw table.error;
  }

  return table.rows;
}

/** El motivo de una consulta que fallo, para un aviso. */
export function describeQueryFailure(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? errorText(error).trim().replace(/\.$/, '')
    : 'error desconocido';
}

/**
 * El aviso de una tabla que no respondio. `unchecked` es el dato escrito que va sin validar (`el idioma 2`): si esta
 * mal, lo rechaza ARCA al emitir. Sin el, solo faltan los nombres.
 */
export function unreadExportTableWarnings(
  table: ExportTable<unknown>,
  name: 'CUIT de países' | 'actividades' | 'idiomas' | 'incoterms' | 'monedas' | 'países' | 'unidades de medida',
  unchecked?: string,
): string[] {
  if (table.ok) {
    return [];
  }

  const effect = unchecked
    ? `${unchecked} va sin validar y, si no es válido, ARCA lo rechaza al emitir.`
    : 'los nombres no se muestran.';

  return [`No se pudo consultar la tabla de ${name} de WSFEX (${describeQueryFailure(table.error)}): ${effect}`];
}
