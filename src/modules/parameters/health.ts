import type { ParametersGateway } from './parameters';
import { areServersOk, probeServers } from './server-status';

/**
 * Estado general de ARCA para la barra del modo interactivo. Sale de FEDummy, que no pide autenticacion:
 * - funcionando: app, db y auth en OK y respuesta rapida
 * - con-demoras: los tres en OK, pero tardo mas de `slowMs`
 * - con-problemas: alguno de los tres no esta en OK
 * - sin-respuesta: error de red o no contesto en `timeoutMs`
 */
export type ArcaHealth = 'con-demoras' | 'con-problemas' | 'funcionando' | 'sin-respuesta';

const ARCA_SLOW_MS = 3000;

export async function checkArcaHealth(options: {
  readonly gateway: Pick<ParametersGateway, 'getServerStatus'>;
  readonly now: () => number;
  readonly slowMs?: number;
  readonly timeoutMs?: number;
}): Promise<ArcaHealth> {
  const { gateway, now, slowMs = ARCA_SLOW_MS, timeoutMs } = options;
  const start = now();
  const servers = await probeServers(() => gateway.getServerStatus(), timeoutMs);

  if (!servers) {
    return 'sin-respuesta';
  }

  if (!areServersOk(servers)) {
    return 'con-problemas';
  }

  return now() - start > slowMs ? 'con-demoras' : 'funcionando';
}
