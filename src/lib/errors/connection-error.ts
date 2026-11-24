/** Como empiezan los errores de conexion de Node y de axios, sin los de archivo (`ETIMEDOUT: …, read '/ruta'`). */
const CONNECTION_ERROR =
  /^(?:(?:connect|read|write|getaddrinfo) (?:EAI_AGAIN|ECONNABORTED|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EPIPE|ETIMEDOUT)\b|socket hang up$|timeout of \d+ms exceeded$|fetch failed$)/;

/** Un error claro de conexion con ARCA; el login en WSAA no cuenta. */
export function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error) || !CONNECTION_ERROR.test(error.message)) {
    return false;
  }

  const { config, hostname } = error as { config?: { url?: string }; hostname?: string } & Error;

  return ![error.message, config?.url, hostname].some((text) => text?.toLowerCase().includes('wsaa'));
}
