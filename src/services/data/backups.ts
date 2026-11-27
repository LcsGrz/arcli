import type { Clock } from '../../lib/time/clock';
import type { ArcliEnvironment } from '../../modules/config/config.schemas';

/**
 * Las copias de comprobantes.db en `datos/<CUIT>/<entorno>/copias/` (ARQ-12 PR 4b): listarlas y restaurar una base
 * desde una copia, para DATOS-1.
 *
 * Stub de Tests primero (ARQ-12 PR 4b), lo implementa nucleo: los tests de backups.test.ts fijan lo que hace.
 */

/** `daily`: la de la primera escritura del día argentino. `migration`: la de antes de migrar. */
type LocalDataBackupKind = 'daily' | 'migration';

export interface LocalDataBackup {
  readonly kind: LocalDataBackupKind;
  /** La ruta absoluta de la copia. */
  readonly path: string;
  /** Cuándo se hizo, ISO UTC (del `Clock` de quien la hizo). */
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
  /** Donde quedó la base que estaba (`comprobantes.reemplazada-<fecha>.db`); sin base, `undefined`. */
  readonly replaced?: string;
}

/**
 * Las copias de la base de un CUIT y entorno. Sin carpeta de copias, ninguna (y no se crea nada).
 *
 * @internal Lo conecta DATOS-1. Stub de Tests primero, lo implementa nucleo.
 */
export function listVoucherBackups(options: VoucherBackupsOptions): Promise<readonly LocalDataBackup[]> {
  void options;

  return Promise.resolve([]);
}

/**
 * Repone comprobantes.db desde una copia sana de la misma base, CUIT y entorno, apartando la actual como
 * `comprobantes.reemplazada-<fecha>.db`. Una copia dañada o de otra base no toca nada.
 *
 * @internal Lo conecta DATOS-1. Stub de Tests primero, lo implementa nucleo.
 */
export function restoreVoucherBackup(options: VoucherBackupsOptions, backup: string): Promise<RestoredVoucherBackup> {
  void options;
  void backup;

  return Promise.reject(new Error('stub de Tests primero, lo implementa nucleo'));
}
