import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, renameSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { restrictFolderToOwner } from '../files/restrict-to-owner';

import { createTemporaryFile, removeQuietly, removeStaleTemporaries, removeTemporary } from './database-temporary';
import type { SqliteConnection } from './sqlite-driver';

/**
 * Los archivos de las copias de una base (ARQ-12 PR 4b): cómo se llaman, cómo se hacen (`VACUUM INTO` a un temporal
 * nuevo de la carpeta de copias, solo para el dueño, y rename) y cuántas quedan. Quién las pide está en
 * database-file.ts (antes de migrar) y sqlite-voucher-record-store.ts (la diaria).
 */

/** Dónde van las copias de una base y con qué nombre empiezan (`comprobantes`, `clientes`). */
export interface BackupTarget {
  readonly folder: string;
  readonly prefix: string;
}

/** `daily`: la de la primera escritura del día argentino. `migration`: la de antes de migrar. */
export type BackupKind = 'daily' | 'migration';

/** Retención decidida el 26/11: 7 diarias y 2 de migración; la de unas no borra las otras. */
const KEPT_BACKUPS: Readonly<Record<BackupKind, number>> = { daily: 7, migration: 2 };

export interface BackupFile {
  readonly kind: BackupKind;
  readonly path: string;
  /** ISO UTC, sacada del nombre (al segundo). */
  readonly createdAt: string;
  readonly sizeBytes: number;
  /** El día argentino del nombre, `YYYY-MM-DD`. */
  readonly day: string;
}

const ARGENTINE_TIMESTAMP_PARTS = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  second: '2-digit',
  timeZone: 'America/Argentina/Buenos_Aires',
  year: 'numeric',
});

/**
 * Argentina está en UTC-3 sin horario de verano desde 2009: con eso se vuelve del nombre (hora argentina) al instante.
 * El día del nombre sale de la base de husos del sistema, como el resto de las fechas argentinas de ARCLI.
 */
const ARGENTINE_OFFSET = '-03:00';

/** `2026-11-26-120000`: el día y la hora argentinos de un instante, para el nombre de una copia o una apartada. */
export function argentineStamp(now: Date): string {
  const parts = Object.fromEntries(
    ARGENTINE_TIMESTAMP_PARTS.formatToParts(now).map(({ type, value }) => [type, value]),
  ) as Record<string, string>;

  return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

/** De `2026-11-26-120000` (`argentineStamp`) al instante, ISO UTC. */
export function argentineStampToIso(stamp: string): string {
  const [, day = '', hour = '00', minute = '00', second = '00'] =
    /^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(stamp) ?? [];

  return new Date(`${day}T${hour}:${minute}:${second}.000${ARGENTINE_OFFSET}`).toISOString();
}

function namePattern(prefix: string): RegExp {
  return new RegExp(
    `^${prefix}-(\\d{4}-\\d{2}-\\d{2})-(\\d{2})(\\d{2})(\\d{2})(?:-antes-de-(\\d+))?(?:-(\\d+))?\\.db$`,
  );
}

/**
 * Para ordenar las del mismo segundo: la diaria, después la de un esquema más nuevo y después la del contador más alto
 * es la última.
 */
interface ListedBackup extends BackupFile {
  readonly schema: number;
  readonly counter: number;
}

/**
 * Las copias de la carpeta, de la más nueva a la más vieja. Sin carpeta, ninguna. Solo cuentan los archivos con el
 * nombre de una copia de esa base: lo demás de la carpeta no se mira ni se borra.
 */
export function listBackupFiles(target: BackupTarget): BackupFile[] {
  let names: string[];

  try {
    names = readdirSync(target.folder);
  } catch {
    return [];
  }

  const pattern = namePattern(target.prefix);
  const found: ListedBackup[] = [];

  for (const name of names) {
    const match = pattern.exec(name);

    if (!match) {
      continue;
    }

    const [, day = '', hour = '00', minute = '00', second = '00', schema, counter = '1'] = match;
    const path = join(target.folder, name);

    try {
      const stats = statSync(path);

      if (stats.isFile()) {
        found.push({
          counter: Number(counter),
          createdAt: argentineStampToIso(`${day}-${hour}${minute}${second}`),
          day,
          kind: schema === undefined ? 'daily' : 'migration',
          path,
          // La diaria se hace después del COMMIT y la de migración antes: en el mismo segundo, la diaria es la última.
          schema: schema === undefined ? Number.MAX_SAFE_INTEGER : Number(schema),
          sizeBytes: stats.size,
        });
      }
    } catch {
      // La borró otro proceso (la retención) mientras se miraba.
    }
  }

  return found
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.schema - a.schema || b.counter - a.counter)
    .map(({ createdAt, day, kind, path, sizeBytes }) => ({ createdAt, day, kind, path, sizeBytes }));
}

/** Borra sin fallar: la retención nunca hace fallar un guardado. */
/** Deja las `KEPT_BACKUPS[kind]` más nuevas de ese tipo; las del otro tipo no se tocan. */
function pruneBackups(
  target: BackupTarget,
  kind: BackupKind,
  now: Date,
  keep: (path: string) => boolean = () => true,
): void {
  // Una con fecha posterior a `now` (el reloj volvió atrás) no cuenta ni se borra.
  const candidates = listBackupFiles(target).filter(
    (candidate) => candidate.kind === kind && Date.parse(candidate.createdAt) <= now.getTime(),
  );
  const kept = candidates.filter(({ path }) => keep(path)).slice(0, KEPT_BACKUPS[kind]);
  // Una que no cuenta pero es más nueva que la más nueva que queda puede ser la de otro proceso en vuelo (hizo su copia
  // y todavía no migró): no se borra; si no le sirve, la descarta él.
  const newestKept = kept[0]?.createdAt ?? '';

  for (const backup of candidates.filter((candidate) => !kept.includes(candidate))) {
    if (keep(backup.path) || backup.createdAt < newestKept) {
      removeQuietly(backup.path);
    }
  }
}

/**
 * La retención de las copias de antes de migrar, después de migrar: quedan las 2 más nuevas de las anotadas en
 * `migraciones.copia`. Las que no están anotadas son de otro proceso que no llegó a migrar (la descarta él) y no
 * cuentan, así que la de quien migró no se borra aunque otro haya hecho una después.
 */
export function pruneMigrationBackups(target: BackupTarget, referenced: ReadonlySet<string>, now: Date): void {
  pruneBackups(target, 'migration', now, (path) => referenced.has(basename(path)));
}

/** Descarta una copia de antes de migrar que no sirvió (otro migró en el medio): es propia y nadie la anotó. */
export function discardBackup(target: BackupTarget, name: string): void {
  removeQuietly(join(target.folder, name));
}

/** Lo escrito queda en el disco antes de ponerle el nombre definitivo. */
function syncFile(path: string): void {
  const descriptor = openSync(path, 'r+');

  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * `VACUUM INTO` a un archivo que ya existe vacío (creado solo para el dueño: el que crearía SQLite queda con el umask)
 * y a disco. `VACUUM INTO` lee en su propia transacción: es una foto entera aunque otro proceso escriba en el medio.
 */
export function vacuumInto(connection: SqliteConnection, emptyFile: string): void {
  connection.run('VACUUM INTO :destino', { destino: emptyFile });
  syncFile(emptyFile);
}

/**
 * Hace una copia de la base de `connection` en la carpeta de copias (que se crea solo para el dueño) y aplica la
 * retención de su tipo. Devuelve la ruta. Si algo falla, lanza y no deja temporales.
 */
export function writeBackup(
  connection: SqliteConnection,
  target: BackupTarget,
  now: Date,
  kind: BackupKind,
  schema?: number,
): string {
  mkdirSync(target.folder, { mode: 0o700, recursive: true });
  restrictFolderToOwner(target.folder);
  removeStaleTemporaries(join(target.folder, `${target.prefix}.db`), now.getTime());

  const base = `${target.prefix}-${argentineStamp(now)}${kind === 'migration' ? `-antes-de-${String(schema)}` : ''}`;
  const temporary = createTemporaryFile(join(target.folder, `${base}.db`));
  let path: string;

  try {
    vacuumInto(connection, temporary);
    path = claimName(temporary, target.folder, base);
  } finally {
    removeTemporary(temporary);
  }

  // La de migración la aplica quien migra, después de la transacción (pruneMigrationBackups).
  if (kind === 'daily') {
    pruneBackups(target, 'daily', now);
  }

  return path;
}

/**
 * Le pone a la copia terminada un nombre libre sin pisar otra: el nombre se reserva con `wx`, que falla si otro
 * proceso lo tomó en el mismo segundo (varios migran a la vez), y se prueba el siguiente (`-2`, `-3`). El rename
 * reemplaza solo esa reserva vacía, también en sistemas sin hard links.
 */
function claimName(temporary: string, folder: string, base: string): string {
  for (let counter = 1; ; counter += 1) {
    const path = join(folder, `${base}${counter === 1 ? '' : `-${counter}`}.db`);

    try {
      closeSync(openSync(path, 'wx', 0o600));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        continue;
      }

      throw error;
    }

    try {
      renameSync(temporary, path);
    } catch (error) {
      removeQuietly(path);
      throw error;
    }

    return path;
  }
}

/** Si ya hay una copia diaria del día argentino de `now`. */
export function hasDailyBackup(target: BackupTarget, now: Date): boolean {
  const today = argentineStamp(now).slice(0, 10);

  return listBackupFiles(target).some(({ day, kind }) => kind === 'daily' && day === today);
}
