const queryErrors = new WeakSet<object>();

/**
 * Lo que falla en una consulta queda marcado, sin cambiarlo: con `ultimos` y `consultar` se verifica una emision, y un
 * error pasajero no puede mandar a emitir de nuevo (ERR-20).
 */
export async function asQuery<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (typeof error === 'object' && error !== null) {
      queryErrors.add(error);
    }

    throw error;
  }
}

export function isQueryError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && queryErrors.has(error);
}

/** Con que cierra la sugerencia de una consulta que fallo. */
export const VERIFY_BEFORE_RETRY =
  'Si estabas verificando una emisión, no la reintentes hasta saber si el comprobante existe.';

/** Que hacer si ARCA contesta una consulta con un error. */
export const ARCA_QUERY_ERROR_SUGGESTION = `Revisá el mensaje de ARCA: si es pasajero, volvé a consultar en unos minutos; si no, corregí lo que dice. Si se repite, no insistas. ${VERIFY_BEFORE_RETRY}`;
