import { renameSync, statSync } from 'node:fs';
import { basename } from 'node:path';

import type { Clock } from '../../lib/time/clock';
import type { ArcliEnvironment } from '../../modules/config/config.schemas';
import { LocalDataError } from '../../modules/local-data/local-data-error';

import { type BackupKind, listBackupFiles } from './backup-files';
import { publishFromCopy, setAside } from './damaged';
import { ensureFolders, openVerifiedCopy, withLockOf } from './database-file';
import { loadSqliteDriver } from './sqlite-driver';
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
 * Lo que otro ARCLI guarde mientras se restaura puede quedar en la reemplazada: DATOS-1 lo tiene que avisar.
 *
 * @internal Lo conecta DATOS-1.
 */
export async function restoreVoucherBackup(
  options: VoucherBackupsOptions,
  backup: string,
): Promise<RestoredVoucherBackup> {
  const spec = vouchersDatabaseSpec(options);
  const driver = await loadSqliteDriver();
  const now = options.clock.now();
  const context = { now: now.toISOString(), version: options.version };

  // Antes de tocar nada, la copia tiene que servir.
  openVerifiedCopy(driver, spec, backup).close();
  ensureFolders(spec);

  return withLockOf(spec, async () => {
    const replaced = hasCurrentDatabase(spec.file)
      ? await setAside(spec.file, 'reemplazada', now, 'locked')
      : undefined;

    try {
      publishFromCopy(driver, spec, context, backup, {
        copia: basename(backup),
        ...(replaced === undefined ? {} : { reemplazada: basename(replaced) }),
      });
    } catch (error) {
      if (replaced !== undefined) {
        try {
          // No se pudo reponer: la que estaba vuelve a su lugar.
          renameSync(replaced, spec.file);
        } catch {
          // Queda como reemplazada: no se borra nada.
        }
      }

      throw error;
    }

    return replaced === undefined ? { restoredFrom: backup } : { replaced, restoredFrom: backup };
  });
}
