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

/** Lee las tablas de una resolucion de la E. Se crea una por resolucion. */
export interface ExportTableReader {
  /** Otra lectura que tolera sus errores (los permisos): cuenta para `assertConnected`. */
  readonly observe: <T>(read: () => Promise<T>) => Promise<T>;
  /** Corta si lo observado fallo por conexion y antes ya habia fallado una tabla. */
  readonly assertConnected: () => void;
  readonly read: <T>(
    read: () => Promise<readonly T[]>,
    options?: { readonly required?: boolean },
  ) => Promise<ExportTable<T>>;
}

/**
 * Una tabla auxiliar de WSFEX: si no responde, la vista previa sigue sin ella y avisa (EXPO-13). Nunca se emite un dato
 * distinto del que saldria con la tabla: si de ella sale algo que se emite, es `required` y corta con su error, antes de
 * seguir consultando. Se usa despues de una lectura obligatoria de WSFEX (los paises), asi que el acceso ya anduvo. Con
 * dos errores de conexion ya no es una tabla, es la red: corta con el primero, para no emitir a ciegas.
 */
export function createExportTableReader(): ExportTableReader {
  let firstConnectionError: unknown;
  let disconnected = false;

  return {
    assertConnected: () => {
      if (disconnected) {
        throw firstConnectionError;
      }
    },
    observe: async (read) => {
      try {
        return await read();
      } catch (error) {
        disconnected ||= firstConnectionError !== undefined && isConnectionError(error);

        throw error;
      }
    },
    read: async (read, options = {}) => {
      try {
        return { ok: true, rows: await read() };
      } catch (error) {
        if (isConnectionError(error)) {
          if (firstConnectionError !== undefined) {
            throw firstConnectionError;
          }

          firstConnectionError = error;
        }

        if (options.required || !isTolerable(error)) {
          throw error;
        }

        return { error, ok: false, rows: [] };
      }
    },
  };
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

  const failure = `No se pudo consultar la tabla de ${name} de WSFEX (${describeQueryFailure(table.error)})`;

  // ARCA no siempre controla que el CUIT sea del pais de destino: no se promete el rechazo.
  if (unchecked && name === 'CUIT de países') {
    return [`${failure}: ${unchecked} no se pudo comparar con el país. Revisalo antes de emitir.`];
  }

  const plural = unchecked?.startsWith('las ');
  const effect = unchecked
    ? `${unchecked} ${plural ? 'van' : 'va'} sin validar. Si hay un error, ARCA rechaza el comprobante al emitir.`
    : 'los nombres no se muestran.';

  return [`${failure}: ${effect}`];
}
