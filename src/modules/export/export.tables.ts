import { AppError } from '../../lib/errors/app-error';
import { isConnectionError } from '../../lib/errors/connection-error';
import { errorText } from '../../lib/files/file-error';

/** Lo que devolvio una tabla de WSFEX o, si la consulta fallo, por que. */
export type ExportTable<T> =
  | { readonly error: unknown; readonly ok: false; readonly rows: readonly T[] }
  | { readonly ok: true; readonly rows: readonly T[] };

/** El error de WSFEX por un token que no vale. */
const TOKEN_ERROR = /ValidacionDeToken|usuario no autorizado/i;

/**
 * Los errores que se toleran en una tabla: que WSFEX conteste con un error, o uno claro de red. Los demas (WSAA, tickets,
 * certificado, programacion o desconocidos) cortan: con ellos no se sabe si se puede emitir.
 */
function isTolerable(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.code === 'ARCA_EXPORT_ERROR' && !TOKEN_ERROR.test(error.message);
  }

  return isConnectionError(error);
}

/**
 * Una tabla auxiliar de WSFEX: si no responde, la vista previa sigue sin ella y avisa (EXPO-13). Nunca se emite un dato
 * distinto del que saldria con la tabla: si de ella sale algo que se emite, es `required` y corta con su error, antes de
 * seguir consultando. Se usa despues de una lectura obligatoria de WSFEX (los paises), asi que el acceso ya anduvo.
 */
export async function readExportTable<T>(
  read: () => Promise<readonly T[]>,
  options: { readonly required?: boolean } = {},
): Promise<ExportTable<T>> {
  try {
    return { ok: true, rows: await read() };
  } catch (error) {
    if (options.required || !isTolerable(error)) {
      throw error;
    }

    return { error, ok: false, rows: [] };
  }
}

/** El motivo de una consulta que fallo, para un aviso. */
export function describeQueryFailure(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? errorText(error).trim().replace(/\.$/, '')
    : 'error desconocido';
}

/**
 * El aviso de una tabla que no respondio. `unchecked` es lo que se escribio y va sin validar (`el idioma 2`, `las
 * unidades 1, 2`): si esta mal, lo rechaza ARCA al emitir. Sin el, solo faltan los nombres.
 */
export function unreadExportTableWarnings(
  table: ExportTable<unknown>,
  name: 'CUIT de países' | 'actividades' | 'idiomas' | 'incoterms' | 'monedas' | 'unidades de medida',
  unchecked?: string,
): string[] {
  if (table.ok) {
    return [];
  }

  const plural = unchecked?.startsWith('las ');
  const effect = unchecked
    ? `${unchecked} ${plural ? 'van' : 'va'} sin validar. Si hay un error, ARCA rechaza el comprobante al emitir.`
    : 'los nombres no se muestran.';

  return [`No se pudo consultar la tabla de ${name} de WSFEX (${describeQueryFailure(table.error)}): ${effect}`];
}
