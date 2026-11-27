import { basename, dirname, join } from 'node:path';

import type { Clock } from '../../lib/time/clock';
import { resolveClientsDatabaseFile } from '../../modules/local-data/local-data-files';

import { CLIENTS_MIGRATIONS } from './clients-schema';
import { DEFAULT_BUSY_TIMEOUT_MS, openOrCreateDatabase } from './database-file';
import { loadSqliteDriver } from './sqlite-driver';
import { withWriteRetry } from './write-retry';

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
 * @internal Lo conecta CLIENTES-1.
 */
export async function ensureClientsDatabase(options: ClientsDatabaseOptions): Promise<void> {
  const file = resolveClientsDatabaseFile(options.dataDirectory, options.cuit);
  const cuitFolder = dirname(file);
  const driver = await loadSqliteDriver();

  await withWriteRetry(() =>
    openOrCreateDatabase(
      driver,
      {
        busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS,
        file,
        folders: [join(options.dataDirectory, 'datos'), cuitFolder],
        identity: { base: 'clientes', emisor_cuit: basename(cuitFolder) },
        migrations: CLIENTS_MIGRATIONS,
      },
      { now: options.clock.now().toISOString(), version: options.version },
    ).close(),
  );
}
