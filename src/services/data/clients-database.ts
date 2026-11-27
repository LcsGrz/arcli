import type { Clock } from '../../lib/time/clock';

export interface ClientsDatabaseOptions {
  readonly clock: Clock;
  readonly cuit: string;
  readonly dataDirectory: string;
  readonly version: string;
}

/**
 * Crea `datos/<CUIT>/clientes.db` en v1 si no está, o la abre y la verifica (versión, `application_id`, `metadatos`),
 * con el mismo driver y las mismas reglas que comprobantes.db. Sin store todavía: lo suma CLIENTES-1.
 *
 * @internal Stub de Tests primero (ARQ-12 PR 4a): lo implementa nucleo; lo conecta CLIENTES-1.
 */
export async function ensureClientsDatabase(_options: ClientsDatabaseOptions): Promise<void> {
  throw new Error('no implementado: stub de Tests primero (ARQ-12 PR 4a), lo implementa nucleo');
}
