/**
 * Se dejo de esperar una consulta a pedido de quien usa el CLI (Ctrl+C en el asistente, ARQ-11): no es una consulta que
 * fallo. Es la razon con la que se cortan las consultas (`withCancellableQueries`), asi que quien ataja los errores de
 * una consulta para seguir sin ella la deja pasar.
 */
export class QueryCancelledError extends Error {
  public constructor() {
    super('Se dejó de esperar la respuesta de ARCA.');
    this.name = 'QueryCancelledError';
  }
}

export function isQueryCancelled(error: unknown): error is QueryCancelledError {
  return error instanceof QueryCancelledError;
}
