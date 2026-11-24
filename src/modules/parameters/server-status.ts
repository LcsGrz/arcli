import type { ServerStatus } from './parameters';

/** Cuanto se espera un estado que no frena nada: pasado eso, es como si ARCA no contestara. */
const ARCA_TIMEOUT_MS = 5000;

const SERVER_OK = 'OK';

export function areServersOk(servers: ServerStatus): boolean {
  return [servers.app, servers.db, servers.auth].every((value) => value === SERVER_OK);
}

/** El estado, o `undefined` si la consulta falla o no contesta en `timeoutMs`. */
export async function probeServers(
  getStatus: () => Promise<ServerStatus>,
  timeoutMs: number = ARCA_TIMEOUT_MS,
): Promise<ServerStatus | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
    timer.unref();
  });

  try {
    return await Promise.race([getStatus(), timeout]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
