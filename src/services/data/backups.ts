import { statSync } from 'node:fs';
import { basename } from 'node:path';

import type { Clock } from '../../lib/time/clock';
import type { ArcliEnvironment } from '../../modules/config/config.schemas';
import { LocalDataError } from '../../modules/local-data/local-data-error';

import { type BackupKind, listBackupFiles } from './backup-files';
import { buildFromCopy, swapIn, withSetAside } from './damaged';
import {
  checkPathLength,
  databaseExists,
  type DatabaseSpec,
  ensureFolders,
  openVerifiedCopy,
  publishBuilt,
  toLocalDataError,
  withLockOf,
} from './database-file';
import { loadSqliteDriver, type SqliteConnection, type SqliteDriver } from './sqlite-driver';
import { vouchersDatabaseSpec } from './sqlite-voucher-record-store';

/**
 * Las copias de comprobantes.db en `datos/<CUIT>/<entorno>/copias/` (ARQ-12 PR 4b): listarlas y restaurar una base
 * desde una copia, para DATOS-1. Cómo se hacen y cuántas quedan está en backup-files.ts.
 */

export interface LocalDataBackup {
  readonly kind: BackupKind;
  /** La ruta absoluta de la copia. */
  readonly path: string;
  /** Cuándo se hizo, ISO UTC al segundo (del `Clock` de quien la hizo: va en el nombre, en hora argentina). */
  readonly createdAt: string;
  readonly sizeBytes: number;
}

export interface VoucherBackupsOptions {
  readonly clock: Clock;
  readonly cuit: string;
  readonly dataDirectory: string;
  readonly environment: ArcliEnvironment;
  readonly version: string;
  /** @internal Solo tests: la espera de SQLite por intento, en ms (por defecto 5000). */
  readonly busyTimeoutMs?: number;
}

export interface RestoredVoucherBackup {
  /** La copia desde la que se repuso la base (no se borra ni se mueve). */
  readonly restoredFrom: string;
  /** Donde quedó la base que estaba (`comprobantes.reemplazada-<día>-<hora>.db`); sin base, `undefined`. */
  readonly replaced?: string;
}

/**
 * Las copias de la base de un CUIT y entorno, de la más nueva a la más vieja. Sin carpeta de copias, ninguna (y no se
 * crea nada). No abre ninguna: una copia de la lista puede estar dañada (`restoreVoucherBackup` lo dice).
 *
 * @internal Lo conecta DATOS-1.
 */
export function listVoucherBackups(options: VoucherBackupsOptions): Promise<readonly LocalDataBackup[]> {
  const { backups } = vouchersDatabaseSpec(options);

  return Promise.resolve(
    listBackupFiles(backups).map(({ createdAt, kind, path, sizeBytes }) => ({ createdAt, kind, path, sizeBytes })),
  );
}

/** Si hay algo en el lugar de la base; una carpeta no es una base y no se mueve. */
function hasCurrentDatabase(file: string): boolean {
  try {
    if (!statSync(file).isFile()) {
      throw new LocalDataError('unavailable', `${file} no es un archivo.`);
    }

    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

/**
 * Repone comprobantes.db desde una copia sana de la misma base, CUIT y entorno, apartando la actual (sana o dañada)
 * como `comprobantes.reemplazada-<día>-<hora>.db` con su `-journal`, y anota el evento `base-repuesta`. Una copia
 * dañada da `damaged`; de otra base, CUIT o entorno, `mismatch`; de un ARCLI más nuevo, `newer-version`: en todos los
 * casos sin tocar nada. Con la base abierta por otro programa (Windows), `locked`. Nada se borra.
 *
 * Antes de apartar la actual se espera a que termine la escritura de otro ARCLI que esté en curso (`BEGIN EXCLUSIVE`).
 * Un ARCLI que ya la tenía abierta y escribe después puede dejar eso en la reemplazada: DATOS-1 tiene que pedir
 * restaurar sin otros ARCLI abiertos.
 *
 * @internal Lo conecta DATOS-1.
 */
export async function restoreVoucherBackup(
  options: VoucherBackupsOptions,
  backup: string,
): Promise<RestoredVoucherBackup> {
  const spec = vouchersDatabaseSpec(options);

  checkPathLength(spec.file);

  const driver = await loadSqliteDriver();
  const now = options.clock.now();
  const context = { now: now.toISOString(), version: options.version };
  /** La base nueva desde la copia, armada en un temporal y todavía sin ponerla. */
  const build = (datos: Record<string, string>) => {
    const source = openVerifiedCopy(driver, spec, backup);

    try {
      return buildFromCopy(driver, spec, context, source, { ...datos, copia: basename(backup) });
    } finally {
      source.close();
    }
  };

  // Antes de tocar nada, la copia tiene que servir.
  openVerifiedCopy(driver, spec, backup).close();
  ensureFolders(spec);

  return withLockOf(driver, spec, async () => {
    if (!hasCurrentDatabase(spec.file)) {
      publishBuilt(spec, build({}), 'fail');

      return { restoredFrom: backup };
    }

    waitForWriters(driver, spec);

    return withSetAside(spec.file, 'reemplazada', now, 'locked', async (aside) => {
      await swapIn(spec, aside, build({ reemplazada: basename(aside) }), 'locked');

      return { replaced: aside, restoredFrom: backup };
    });
  });
}

/**
 * Espera a que termine la escritura en curso de otro ARCLI (`BEGIN EXCLUSIVE` y suelta enseguida). Una base que no se
 * puede abrir (dañada) no tiene a nadie escribiendo: se sigue. Tomada más que la espera, `locked`.
 */
function waitForWriters(driver: SqliteDriver, spec: DatabaseSpec): void {
  let connection: SqliteConnection;

  try {
    // Una que ni tiene la cabecera de SQLite no se abre: SQLite podría deshacer (y borrar) su -journal, que se aparta
    // con ella byte a byte.
    if (!databaseExists(spec.file)) {
      return;
    }

    // Sin pragmas: es una base que no se verificó, y `journal_mode = DELETE` convertiría un WAL ajeno.
    connection = driver.open(spec.file, { mustExist: true, timeoutMs: spec.busyTimeoutMs });
  } catch {
    return;
  }

  try {
    connection.exec('BEGIN EXCLUSIVE');
    connection.exec('ROLLBACK');
  } catch (error) {
    const mapped = toLocalDataError(error);

    if (mapped instanceof LocalDataError && mapped.reason === 'locked') {
      throw mapped;
    }
  } finally {
    connection.close();
  }
}
