import type { ArcliConfig, ArcliEnvironment } from '../modules/config/config.schemas';
import type { MonotributoReport } from '../modules/monotributo/monotributo.presenter';
import { loadMonotributoTable, resolveOwnCategory } from '../modules/monotributo/monotributo.service';
import { fetchMonotributoPage } from '../modules/monotributo/monotributo.source';
import {
  FileMonotributoStore,
  MemoryMonotributoStore,
  type MonotributoStore,
} from '../modules/monotributo/monotributo.store';
import type { ArcaClient } from '../services/arca/arca-client.factory';
import { ArcaPadronGateway } from '../services/arca/arca-padron.gateway';

import { withSpinner } from './spinner';
import { CLI_VERSION } from './version';

export interface LoadMonotributoReportInput {
  /** La config, si se pudo leer: la tabla se muestra igual sin ella, pero sin marcar la categoria propia. */
  readonly config?: ArcliConfig;
  /** El cliente de ARCA para el padron; se pide solo si hace falta consultarlo, y si falla no se marca nada. */
  readonly createArca: () => ArcaClient;
  readonly environment: ArcliEnvironment;
  /** Sin spinner (por ejemplo, con `--json`). */
  readonly quiet: boolean;
  readonly refresh: boolean;
  /** Solo los tests lo cambian. */
  readonly store?: MonotributoStore;
}

/** La carpeta de config puede no poder escribirse (permisos, disco lleno): la tabla se muestra igual, sin guardarla. */
function openStore(): MonotributoStore {
  try {
    return new FileMonotributoStore();
  } catch {
    return new MemoryMonotributoStore();
  }
}

/**
 * La tabla de categorias y la categoria propia, para `arcli monotributo` y "Categorías del monotributo". La pagina
 * de ARCA es publica; el padron usa el certificado de la config.
 */
export async function loadMonotributoReport(input: LoadMonotributoReportInput): Promise<MonotributoReport> {
  const store = input.store ?? openStore();
  const now = new Date();
  const spinner = (text: string) => (input.quiet ? null : text);
  const loaded = await loadMonotributoTable({
    fetchPage: () => withSpinner(spinner('Consultando la tabla en ARCA...'), () => fetchMonotributoPage()),
    now,
    refresh: input.refresh,
    store,
    version: CLI_VERSION,
  });
  const ownCategory = await resolveOwnCategory({
    cuit: input.config?.cuit,
    environment: input.environment,
    lookup: () =>
      withSpinner(spinner('Consultando tu categoría en el padrón...'), async () => {
        const taxpayer = await new ArcaPadronGateway(input.createArca()).getTaxpayer(Number(input.config?.cuit));

        return taxpayer?.monotributoCategoryLetter ?? null;
      }),
    now,
    refresh: input.refresh,
    store,
  });

  return { ...loaded, configuredLimit: input.config?.monotributo?.tope, ownCategory, version: CLI_VERSION };
}
