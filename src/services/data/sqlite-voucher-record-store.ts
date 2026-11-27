import type { Clock } from '../../lib/time/clock';
import type { ArcliEnvironment } from '../../modules/config/config.schemas';
import type { VoucherRecordStore } from '../../modules/vouchers/voucher-record-store';

import type { SqliteMigration } from './migrations';

export interface SqliteVoucherRecordStoreOptions {
  readonly clock: Clock;
  readonly cuit: string;
  /** La carpeta de datos (la de la config): la base va en `datos/<CUIT>/<entorno>/comprobantes.db`. */
  readonly dataDirectory: string;
  readonly environment: ArcliEnvironment;
  /** La versión de ARCLI que escribe, para `metadatos`, `migraciones` y cada fila. */
  readonly version: string;
  /** @internal Solo tests: la espera de SQLite por intento, en ms (por defecto 5000). */
  readonly busyTimeoutMs?: number;
  /** @internal Solo tests: pasos que se corren después del esquema v1 (una "menor" de prueba). */
  readonly extraMigrations?: readonly SqliteMigration[];
}

/**
 * Los comprobantes de un CUIT y entorno en SQLite. No abre nada al armarse: cada operación abre, hace lo suyo y
 * cierra, y la base se crea en el primer `save`.
 *
 * @internal Stub de Tests primero (ARQ-12 PR 4a): lo implementa nucleo; lo conecta LIBRO-1.
 */
export function openSqliteVoucherRecordStore(_options: SqliteVoucherRecordStoreOptions): VoucherRecordStore {
  throw new Error('no implementado: stub de Tests primero (ARQ-12 PR 4a), lo implementa nucleo');
}
