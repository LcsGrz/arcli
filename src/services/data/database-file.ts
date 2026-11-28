import { closeSync, fstatSync, mkdirSync, openSync, readSync, statSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import { LocalDataError, type LocalDataErrorReason } from '../../modules/local-data/local-data-error';
import { restrictFolderToOwner } from '../files/restrict-to-owner';

import { type BackupTarget, discardBackup, pruneMigrationBackups, writeBackup } from './backup-files';
import { withDatabaseLock } from './database-lock';
import { createTemporaryFile, publishTemporary, removeStaleTemporaries, removeTemporary } from './database-temporary';
import {
  applyMigrations,
  inImmediateTransaction,
  latestVersion,
  migrate,
  type MigrationBackup,
  type MigrationContext,
  readUserVersion,
  schemaMajor,
  type SqliteMigration,
} from './migrations';
import type { SqliteConnection, SqliteDriver } from './sqlite-driver';
import { classifySqliteError } from './sqlite-errors';

/** `'arcl'`: el `application_id` de las bases de ARCLI. Otro valor es la base de otro programa. */
const ARCLI_APPLICATION_ID = 1634886508;

/**
 * La espera de cada sentencia cuando otro proceso tiene la base, por intento (decidido el 26/11: 5 s y 3 intentos). El
 * driver la hace de a vueltas cortas (`BUSY_SLICE_MS`, ARQ-30).
 */
export const DEFAULT_BUSY_TIMEOUT_MS = 5000;

/**
 * En Windows SQLite no abre rutas de 259 caracteres o más (medido en el CI del 25/11 con Node 22, 24 y 26: 250 abre y
 * escribe, con un `-journal` de 258; 259 da SQLITE_CANTOPEN). La base tiene que dejar lugar a su `-journal` (8 más):
 * 250 es lo medido. El temporal donde se arma tiene el mismo largo que la base (database-temporary.ts). Se dice
 * antes, sin crear carpetas.
 */
const WINDOWS_MAX_DATABASE_PATH = 250;

/** La cabecera de un archivo de SQLite (https://www.sqlite.org/fileformat.html#the_database_header). */
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');
/** El tamaño de página más chico: una base de SQLite nunca pesa menos. */
const SQLITE_MIN_SIZE = 512;

/** Lo que distingue una base de ARCLI de otra: la base y su dueño, en `metadatos`. */
export interface DatabaseSpec {
  readonly file: string;
  /** Las carpetas que se crean solo para el dueño al crear la base, de afuera hacia adentro. */
  readonly folders: readonly string[];
  /** Las claves de `metadatos` que tienen que coincidir con la ruta (`base`, `emisor_cuit`, `entorno`). */
  readonly identity: Readonly<Record<string, string>>;
  readonly migrations: readonly SqliteMigration[];
  readonly busyTimeoutMs: number;
  /** Dónde van sus copias: la de antes de migrar se hace siempre (ARQ-12 PR 4b). */
  readonly backups: BackupTarget;
  /** El archivo del turno de la base (database-lock.ts), en `datos/`. */
  readonly lock: string;
}

const ERRNO_REASONS: Readonly<Record<string, LocalDataErrorReason>> = {
  EACCES: 'read-only',
  EDQUOT: 'disk-full',
  EISDIR: 'unavailable',
  ENAMETOOLONG: 'path-too-long',
  ENOENT: 'unavailable',
  ENOSPC: 'disk-full',
  ENOTDIR: 'unavailable',
  EPERM: 'read-only',
  EROFS: 'read-only',
};

/** Un error de SQLite o del disco, como `LocalDataError` si dice algo de la base; si no (un bug), como vino. */
export function toLocalDataError(error: unknown): unknown {
  if (error instanceof LocalDataError) {
    return error;
  }

  const kind = classifySqliteError(error);

  if (kind !== undefined && kind !== 'unique') {
    return new LocalDataError(kind, (error as Error).message, { cause: error });
  }

  const { code } = (error ?? {}) as NodeJS.ErrnoException;
  const reason = typeof code === 'string' ? ERRNO_REASONS[code] : undefined;

  return reason === undefined ? error : new LocalDataError(reason, (error as Error).message, { cause: error });
}

export function checkPathLength(file: string): void {
  if (process.platform === 'win32' && file.length > WINDOWS_MAX_DATABASE_PATH) {
    throw new LocalDataError(
      'path-too-long',
      `La ruta de la base tiene ${file.length} caracteres: en Windows SQLite no la abre (con su -journal) si pasa de ${WINDOWS_MAX_DATABASE_PATH}.`,
    );
  }
}

/**
 * Mira la cabecera sin SQLite: `false` si no está, y `LocalDataError('damaged')` si no es una base de SQLite (vacía,
 * cortada, otro formato). Una carpeta en su lugar no es daño: `unavailable`.
 */
export function databaseExists(file: string): boolean {
  let descriptor: number;

  try {
    descriptor = openSync(file, 'r');
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;

    if (code === 'ENOENT') {
      return false;
    }

    // Sin permiso para leer la base no es que la carpeta sea de solo lectura: no se puede abrir.
    throw code === 'EACCES' || code === 'EPERM'
      ? new LocalDataError('unavailable', `No hay permiso para leer ${file}.`, { cause: error })
      : toLocalDataError(error);
  }

  try {
    const stats = fstatSync(descriptor);

    if (!stats.isFile()) {
      throw new LocalDataError('unavailable', `${file} no es un archivo.`);
    }

    const header = Buffer.alloc(SQLITE_HEADER.length);

    if (stats.size < SQLITE_MIN_SIZE || readSync(descriptor, header, 0, header.length, 0) < header.length) {
      throw new LocalDataError('damaged', `${file} pesa ${stats.size} bytes: no es una base de SQLite entera.`);
    }

    if (!header.equals(SQLITE_HEADER)) {
      throw new LocalDataError('damaged', `${file} no es una base de SQLite.`);
    }

    return true;
  } catch (error) {
    throw toLocalDataError(error);
  } finally {
    closeSync(descriptor);
  }
}

/** Lo de cada conexión que escribe: lo que se guardó está en el disco al volver (FULL y, en macOS, fullfsync). */
const CONNECTION_PRAGMAS = [
  'PRAGMA journal_mode = DELETE',
  'PRAGMA synchronous = FULL',
  'PRAGMA fullfsync = 1',
  'PRAGMA trusted_schema = OFF',
  'PRAGMA foreign_keys = ON',
].join('; ');

function openConnection(driver: SqliteDriver, file: string, spec: DatabaseSpec, readOnly = false): SqliteConnection {
  try {
    // Siempre un archivo que ya está (la base, su temporal creado con `wx`, una copia): SQLite no crea ninguno.
    return driver.open(file, { mustExist: true, readOnly, timeoutMs: spec.busyTimeoutMs });
  } catch (error) {
    throw toLocalDataError(error);
  }
}

/** Una conexión que escribe, con los pragmas de siempre: para armar una base en su temporal. */
export function openWritableConnection(driver: SqliteDriver, file: string, spec: DatabaseSpec): SqliteConnection {
  const connection = openConnection(driver, file, spec);

  try {
    connection.exec(CONNECTION_PRAGMAS);

    return connection;
  } catch (error) {
    connection.close();
    throw toLocalDataError(error);
  }
}

/**
 * El dueño y la versión, antes de escribir nada (ni un pragma). Primero el `application_id`: otro (o una versión de 0 a
 * 999) es la base de otro programa, `mismatch`, aunque su versión sea alta. Si es de ARCLI, una mayor desconocida es
 * `newer-version`. `metadatos` de otro CUIT o entorno se miran después (`checkHealthAndIdentity`).
 */
/**
 * El `application_id` y `user_version` escritos en la cabecera del archivo (bytes 68 y 60, big-endian), leídos sin
 * SQLite. `undefined` si no se pueden leer.
 */
function rawHeaderIdentity(file: string): { readonly applicationId: number; readonly userVersion: number } | undefined {
  try {
    const descriptor = openSync(file, 'r');

    try {
      const header = Buffer.alloc(100);

      return readSync(descriptor, header, 0, header.length, 0) < header.length
        ? undefined
        : { applicationId: header.readUInt32BE(68), userVersion: header.readUInt32BE(60) };
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return undefined;
  }
}

/**
 * Lo que SQLite dice que no es de ARCLI, pero la cabecera del archivo sí: SQLite no la pudo leer entera (una base
 * cortada a la mitad dio `application_id` 0 en el CI de Linux con Node 22.22.1, PR #318), así que es `damaged`, no
 * `mismatch`. Una base de otro programa no tiene `'arcl'` en la cabecera y sigue siendo `mismatch`.
 */
function notArcli(spec: Pick<DatabaseSpec, 'file'>, message: string): LocalDataError {
  const raw = rawHeaderIdentity(spec.file);

  return raw !== undefined && raw.applicationId === ARCLI_APPLICATION_ID && schemaMajor(raw.userVersion) >= 1
    ? new LocalDataError('damaged', `${spec.file} está dañada: SQLite no lee su cabecera.`)
    : new LocalDataError('mismatch', message);
}

function checkVersionAndOwner(connection: SqliteConnection, spec: Pick<DatabaseSpec, 'file' | 'migrations'>): void {
  const applicationId = Number(connection.get('PRAGMA application_id')?.application_id ?? 0);
  const userVersion = readUserVersion(connection);

  if (applicationId !== ARCLI_APPLICATION_ID) {
    throw notArcli(spec, `${spec.file} no es una base de ARCLI.`);
  }

  if (schemaMajor(userVersion) > schemaMajor(latestVersion(spec.migrations))) {
    throw new LocalDataError(
      'newer-version',
      `${spec.file} es del esquema ${userVersion}: la escribió un ARCLI más nuevo y no se toca.`,
    );
  }

  if (schemaMajor(userVersion) < 1) {
    throw notArcli(spec, `${spec.file} tiene la versión ${userVersion}: no es una base de ARCLI.`);
  }
}

function checkHealthAndIdentity(connection: SqliteConnection, spec: Pick<DatabaseSpec, 'file' | 'identity'>): void {
  const check = connection.get('PRAGMA quick_check')?.quick_check;

  if (check !== 'ok') {
    throw new LocalDataError('damaged', `${spec.file} está dañada: ${String(check)}.`);
  }

  const hasMetadata = connection.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'metadatos'");
  const stored = new Map(
    (hasMetadata ? connection.all('SELECT clave, valor FROM metadatos') : []).map((row) => [row.clave, row.valor]),
  );
  const different = Object.entries(spec.identity).filter(([key, value]) => stored.get(key) !== value);

  if (different.length > 0) {
    throw new LocalDataError(
      'mismatch',
      `${spec.file} es de otra base (${different.map(([key]) => `${key}: ${String(stored.get(key) ?? 'sin dato')}`).join(', ')}).`,
    );
  }
}

/**
 * La copia de antes de migrar, con el nombre que va a `migraciones.copia`. Se hace siempre (no depende de las copias
 * diarias). Si falla, no se migra: `unavailable`, salvo la base tomada por otro (`locked`), que se reintenta.
 */
function backupBeforeMigration(connection: SqliteConnection, spec: DatabaseSpec, context: MigrationContext): string {
  try {
    return basename(
      writeBackup(connection, spec.backups, new Date(context.now), 'migration', latestVersion(spec.migrations)),
    );
  } catch (error) {
    const mapped = toLocalDataError(error);

    if (mapped instanceof LocalDataError && mapped.reason === 'locked') {
      throw mapped;
    }

    throw new LocalDataError(
      'unavailable',
      `No se pudo copiar ${spec.file} antes de migrarla (${String((error as Error | undefined)?.message)}): no se migra.`,
      { cause: error },
    );
  }
}

/**
 * La copia de antes de migrar para `migrate`: hacerla, descartarla si no sirvió (otro migró en el medio, o la migración
 * falló y se deshizo sin anotarla) y la retención.
 */
function migrationBackup(connection: SqliteConnection, spec: DatabaseSpec, context: MigrationContext): MigrationBackup {
  return {
    discard: (copy) => discardBackup(spec.backups, copy),
    settle() {
      try {
        const referenced = connection
          .all('SELECT copia FROM migraciones WHERE copia IS NOT NULL')
          .map(({ copia }) => String(copia));

        pruneMigrationBackups(spec.backups, new Set(referenced), new Date(context.now));
      } catch {
        // La retención nunca hace fallar la operación: queda una copia de más hasta la próxima migración.
      }
    },
    take: () => backupBeforeMigration(connection, spec, context),
  };
}

/**
 * Abre una base que existe, en orden: cabecera (lo hizo `databaseExists`), versión y dueño sin escribir nada, pragmas,
 * `quick_check`, `metadatos` y, si hace falta, la copia de antes de migrar y la migración. La conexión es normal y no
 * `readOnly`: tras un corte queda un `-journal` caliente que solo una conexión que escribe puede deshacer
 * (SQLITE_READONLY_ROLLBACK).
 */
export function openVerified(driver: SqliteDriver, spec: DatabaseSpec, context: MigrationContext): SqliteConnection {
  const connection = openConnection(driver, spec.file, spec);

  try {
    checkVersionAndOwner(connection, spec);
    connection.exec(CONNECTION_PRAGMAS);
    checkHealthAndIdentity(connection, spec);
    migrate(connection, spec.migrations, context, migrationBackup(connection, spec, context));

    return connection;
  } catch (error) {
    connection.close();
    throw toLocalDataError(error);
  }
}

/**
 * Una copia, para reponer o restaurar desde ella: se abre `readOnly` (no se toca nada del archivo, ni un `-journal`) y
 * tiene que ser una base entera y sana de la misma base, CUIT y entorno: si no, `damaged`, `mismatch` o
 * `newer-version`. Una que no está es `unavailable`.
 */
export function openVerifiedCopy(driver: SqliteDriver, spec: DatabaseSpec, copy: string): SqliteConnection {
  if (!databaseExists(copy)) {
    throw new LocalDataError('unavailable', `La copia ${copy} no está.`);
  }

  const connection = openConnection(driver, copy, spec, true);

  try {
    checkVersionAndOwner(connection, { file: copy, migrations: spec.migrations });
    checkHealthAndIdentity(connection, { file: copy, identity: spec.identity });

    return connection;
  } catch (error) {
    connection.close();
    throw toLocalDataError(error);
  }
}

/** Corre `work` con el turno de la base (database-lock.ts); un error al pedirlo, como `LocalDataError` si dice algo. */
export async function withLockOf<T>(driver: SqliteDriver, spec: DatabaseSpec, work: () => Promise<T> | T): Promise<T> {
  try {
    return await withDatabaseLock(driver, spec.lock, work);
  } catch (error) {
    throw toLocalDataError(error);
  }
}

/** Las carpetas de la base, solo para el dueño. */
export function ensureFolders(spec: DatabaseSpec): void {
  try {
    mkdirSync(dirname(spec.file), { mode: 0o700, recursive: true });
    spec.folders.forEach(restrictFolderToOwner);
  } catch (error) {
    throw toLocalDataError(error);
  }
}

/**
 * Un temporal nuevo en la carpeta de la base (vacío y solo para el dueño) que `build` llena: la base que va a ir en su
 * lugar, todavía sin ponerla. Si `build` falla, el temporal se borra. Las carpetas ya tienen que estar.
 */
export function buildTemporary(
  spec: DatabaseSpec,
  context: MigrationContext,
  build: (temporary: string) => void,
): string {
  try {
    removeStaleTemporaries(spec.file, Date.parse(context.now));

    const temporary = createTemporaryFile(spec.file);

    try {
      build(temporary);

      return temporary;
    } catch (error) {
      removeTemporary(temporary);
      throw error;
    }
  } catch (error) {
    throw toLocalDataError(error);
  }
}

/** Pone el temporal armado en el lugar de la base sin pisar otra (`publishTemporary`) y lo borra. */
export function publishBuilt(spec: DatabaseSpec, temporary: string, ifTaken: 'fail' | 'keep' = 'keep'): void {
  try {
    publishTemporary(temporary, spec.file, ifTaken);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new LocalDataError(
        'unavailable',
        `Apareció otro archivo en el lugar de ${spec.file} al reponerla: no se pisa.`,
        {
          cause: error,
        },
      );
    }

    throw toLocalDataError(error);
  } finally {
    removeTemporary(temporary);
  }
}

/**
 * Llena `temporary` con la base entera vacía: esquema, `application_id` y `metadatos` en una transacción, más lo que
 * sume `extra` en la misma.
 */
export function buildEmptyDatabase(
  driver: SqliteDriver,
  spec: DatabaseSpec,
  context: MigrationContext,
  temporary: string,
  extra?: (connection: SqliteConnection) => void,
): void {
  const creationMetadata = { creada_el: context.now, creada_por_version: context.version };
  const connection = openWritableConnection(driver, temporary, spec);

  try {
    inImmediateTransaction(connection, () => {
      applyMigrations(connection, spec.migrations, 0, context);
      connection.exec(`PRAGMA application_id = ${ARCLI_APPLICATION_ID}`);

      for (const [clave, valor] of Object.entries({ ...spec.identity, ...creationMetadata })) {
        connection.run('INSERT INTO metadatos (clave, valor) VALUES (:clave, :valor)', { clave, valor });
      }

      extra?.(connection);
    });
  } finally {
    connection.close();
  }
}

/**
 * Crea la base entera en un temporal y recién ahí la pone en su lugar: nadie ve una base a medias. Las carpetas ya
 * tienen que estar (`ensureFolders`).
 */
export function createDatabase(driver: SqliteDriver, spec: DatabaseSpec, context: MigrationContext): void {
  publishBuilt(
    spec,
    buildTemporary(spec, context, (temporary) => buildEmptyDatabase(driver, spec, context, temporary)),
  );
}

/** Para leer: la base abierta y verificada, o `undefined` si no está (y no se crea nada). */
export function openExistingDatabase(
  driver: SqliteDriver,
  spec: DatabaseSpec,
  context: MigrationContext,
): SqliteConnection | undefined {
  checkPathLength(spec.file);

  for (let attempt = 1; ; attempt += 1) {
    const before = fileIdentity(spec.file);

    if (!databaseExists(spec.file)) {
      return undefined;
    }

    try {
      return openVerified(driver, spec, context);
    } catch (error) {
      if (attempt >= VANISHED_ATTEMPTS || !vanished(error, spec.file, before)) {
        throw error;
      }
    }
  }
}

/** Cuántas veces se vuelve a mirar una base que otro movió entre que se miró y se abrió. */
const VANISHED_ATTEMPTS = 3;

/**
 * Qué archivo está en esa ruta (dispositivo, inodo y fecha de creación); `undefined` si ninguno. Con `bigint`: en
 * Windows el inodo es el File ID de NTFS (número de secuencia en los 16 bits altos), que pasa de 2^53 en un disco
 * usado, y como `number` dos archivos vecinos dan el mismo (ARQ-29, CI de #319). La fecha de creación no los distingue
 * ahí: NTFS le pone al archivo nuevo la del que estaba en esa ruta (file system tunneling).
 */
export function fileIdentity(file: string): string | undefined {
  try {
    const { birthtimeNs, dev, ino } = statSync(file, { bigint: true });

    // Con la fecha de creación: en Linux el inodo de un archivo recién borrado se reusa enseguida (CI de #318).
    return `${dev}:${ino}:${birthtimeNs}`;
  } catch {
    return undefined;
  }
}

/**
 * No se pudo abrir porque el archivo ya no es el que se miró: otro proceso lo movió en el medio (apartó la dañada o
 * restauró una copia). Se vuelve a mirar y vale la que puso el otro (crear espera su turno). En una ruta UNC de
 * Windows, que se abre sin `mustExist`, SQLite crea en ese hueco un archivo vacío y lo que se ve es `mismatch` sobre un
 * archivo nuevo de menos de 512 bytes: también se vuelve a mirar (esa carrera en UNC no está probada).
 */
function vanished(error: unknown, file: string, before: string | undefined): boolean {
  if (!(error instanceof LocalDataError) || fileIdentity(file) === before) {
    return false;
  }

  return error.reason === 'unavailable' || (error.reason === 'mismatch' && fileSize(file) < SQLITE_MIN_SIZE);
}

function fileSize(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * Para escribir: la abre o, si no está, la crea en la última versión, con `metadatos` y carpetas solo del dueño. Crear
 * es con el turno de la base: si otro la está creando o reponiendo, se espera y vale la suya. Con el turno y sin base,
 * `whenMissing` decide qué poner (por defecto, una vacía; `save` repone desde las copias si las hay).
 */
export async function openOrCreateDatabase(
  driver: SqliteDriver,
  spec: DatabaseSpec,
  context: MigrationContext,
  whenMissing: () => Promise<void> | void = () => createDatabase(driver, spec, context),
): Promise<SqliteConnection> {
  checkPathLength(spec.file);

  for (let attempt = 1; ; attempt += 1) {
    if (!databaseExists(spec.file)) {
      ensureFolders(spec);
      await withLockOf(driver, spec, async () => {
        if (!databaseExists(spec.file)) {
          await whenMissing();
        }
      });
    }

    const before = fileIdentity(spec.file);

    try {
      return openVerified(driver, spec, context);
    } catch (error) {
      if (attempt >= VANISHED_ATTEMPTS || !vanished(error, spec.file, before)) {
        throw error;
      }
    }
  }
}
