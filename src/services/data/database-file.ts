import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  copyFileSync,
  fchmodSync,
  fstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readSync,
  rmSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { LocalDataError, type LocalDataErrorReason } from '../../modules/local-data/local-data-error';
import { restrictFolderToOwner } from '../files/restrict-to-owner';

import {
  applyMigrations,
  inImmediateTransaction,
  latestVersion,
  migrate,
  type MigrationContext,
  readUserVersion,
  schemaMajor,
  type SqliteMigration,
} from './migrations';
import type { SqliteConnection, SqliteDriver } from './sqlite-driver';
import { classifySqliteError } from './sqlite-errors';

/** `'arcl'`: el `application_id` de las bases de ARCLI. Otro valor es la base de otro programa. */
const ARCLI_APPLICATION_ID = 1634886508;

/** La espera de SQLite cuando otro proceso tiene la base, por intento (decidido el 26/11: 5 s y 3 intentos). */
export const DEFAULT_BUSY_TIMEOUT_MS = 5000;

/**
 * En Windows SQLite no abre una base cuya ruta tenga 259 caracteres o más (medido en el CI del 25/11 con Node 22, 24
 * y 26: 250 abre, 259 da SQLITE_CANTOPEN). Se dice antes, sin crear carpetas.
 */
const WINDOWS_MAX_DATABASE_PATH = 258;

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

function checkPathLength(file: string): void {
  if (process.platform === 'win32' && file.length > WINDOWS_MAX_DATABASE_PATH) {
    throw new LocalDataError(
      'path-too-long',
      `La ruta de la base tiene ${file.length} caracteres: en Windows SQLite no abre rutas de 259 o más.`,
    );
  }
}

/**
 * Mira la cabecera sin SQLite: `false` si no está, y `LocalDataError('damaged')` si no es una base de SQLite (vacía,
 * cortada, otro formato). Una carpeta en su lugar no es daño: `unavailable`.
 */
function databaseExists(file: string): boolean {
  let descriptor: number;

  try {
    descriptor = openSync(file, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }

    throw toLocalDataError(error);
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

function openConnection(driver: SqliteDriver, file: string, spec: DatabaseSpec): SqliteConnection {
  try {
    return driver.open(file, { timeoutMs: spec.busyTimeoutMs });
  } catch (error) {
    throw toLocalDataError(error);
  }
}

/**
 * La versión y el dueño, antes de escribir nada (ni un pragma): una mayor desconocida es `newer-version`; otro
 * `application_id`, una versión que no es de ARCLI (0 a 999) o `metadatos` de otro CUIT o entorno, `mismatch`.
 */
function checkVersionAndOwner(connection: SqliteConnection, spec: DatabaseSpec): void {
  const userVersion = readUserVersion(connection);
  const applicationId = Number(connection.get('PRAGMA application_id')?.application_id ?? 0);

  if (schemaMajor(userVersion) > schemaMajor(latestVersion(spec.migrations))) {
    throw new LocalDataError(
      'newer-version',
      `${spec.file} es del esquema ${userVersion}: la escribió un ARCLI más nuevo y no se toca.`,
    );
  }

  if (applicationId !== ARCLI_APPLICATION_ID || schemaMajor(userVersion) < 1) {
    throw new LocalDataError('mismatch', `${spec.file} no es una base de ARCLI.`);
  }
}

function checkHealthAndIdentity(connection: SqliteConnection, spec: DatabaseSpec): void {
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
 * Abre una base que existe, en orden: cabecera (lo hizo `databaseExists`), versión y dueño sin escribir nada, pragmas,
 * `quick_check`, `metadatos` y, si hace falta, la migración. La conexión es normal y no `readOnly`: tras un corte queda
 * un `-journal` caliente que solo una conexión que escribe puede deshacer (SQLITE_READONLY_ROLLBACK).
 */
function openVerified(driver: SqliteDriver, spec: DatabaseSpec, context: MigrationContext): SqliteConnection {
  const connection = openConnection(driver, spec.file, spec);

  try {
    checkVersionAndOwner(connection, spec);
    connection.exec(CONNECTION_PRAGMAS);
    checkHealthAndIdentity(connection, spec);
    migrate(connection, spec.migrations, context);

    return connection;
  } catch (error) {
    connection.close();
    throw toLocalDataError(error);
  }
}

/** Un archivo nuevo solo para el dueño, con un nombre que no pisa a nadie y no es más largo que el de la base. */
function createTemporaryFile(folder: string): string {
  for (;;) {
    const path = join(folder, `nueva${randomBytes(3).toString('hex')}`);

    try {
      const descriptor = openSync(path, 'wx', 0o600);

      try {
        if (process.platform !== 'win32') {
          fchmodSync(descriptor, 0o600);
        }
      } finally {
        closeSync(descriptor);
      }

      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }
}

/** Los errores de `linkSync` que dicen que el sistema de archivos no tiene hard links (FAT, exFAT, algunos de red). */
const NO_HARD_LINKS = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EMLINK', 'EXDEV']);

/**
 * Pone la base armada en su lugar sin pisar otra: un hard link falla si ya está (otro proceso la creó a la vez, y vale
 * esa). Sin hard links, una copia que también falla si ya está; mientras se copia, otro la vería cortada (`damaged`).
 */
function publish(temporary: string, file: string): void {
  try {
    linkSync(temporary, file);
  } catch (error) {
    const { code = '' } = error as NodeJS.ErrnoException;

    if (code === 'EEXIST') {
      return;
    }

    if (!NO_HARD_LINKS.has(code)) {
      throw error;
    }

    try {
      copyFileSync(temporary, file, constants.COPYFILE_EXCL);
    } catch (copyError) {
      if ((copyError as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw copyError;
      }
    }
  }
}

/**
 * Crea la base entera en un temporal de la misma carpeta (esquema, `application_id` y `metadatos` en una
 * transacción) y recién ahí la pone en su lugar: nadie ve una base a medias. Las carpetas quedan solo para el dueño.
 */
function createDatabase(
  driver: SqliteDriver,
  spec: DatabaseSpec,
  context: MigrationContext,
  creationMetadata: Readonly<Record<string, string>>,
): void {
  const folder = dirname(spec.file);

  try {
    mkdirSync(folder, { mode: 0o700, recursive: true });
    spec.folders.forEach(restrictFolderToOwner);

    const temporary = createTemporaryFile(folder);

    try {
      const connection = openConnection(driver, temporary, spec);

      try {
        connection.exec(CONNECTION_PRAGMAS);
        inImmediateTransaction(connection, () => {
          applyMigrations(connection, spec.migrations, 0, context);
          connection.exec(`PRAGMA application_id = ${ARCLI_APPLICATION_ID}`);

          for (const [clave, valor] of Object.entries({ ...spec.identity, ...creationMetadata })) {
            connection.run('INSERT INTO metadatos (clave, valor) VALUES (:clave, :valor)', { clave, valor });
          }
        });
      } finally {
        connection.close();
      }

      publish(temporary, spec.file);
    } finally {
      rmSync(temporary, { force: true });
      rmSync(`${temporary}-journal`, { force: true });
    }
  } catch (error) {
    throw toLocalDataError(error);
  }
}

/** Para leer: la base abierta y verificada, o `undefined` si no está (y no se crea nada). */
export function openExistingDatabase(
  driver: SqliteDriver,
  spec: DatabaseSpec,
  context: MigrationContext,
): SqliteConnection | undefined {
  checkPathLength(spec.file);

  return databaseExists(spec.file) ? openVerified(driver, spec, context) : undefined;
}

/** Para escribir: la abre o, si no está, la crea en la última versión, con `metadatos` y carpetas solo del dueño. */
export function openOrCreateDatabase(
  driver: SqliteDriver,
  spec: DatabaseSpec,
  context: MigrationContext,
): SqliteConnection {
  checkPathLength(spec.file);

  if (!databaseExists(spec.file)) {
    createDatabase(driver, spec, context, { creada_el: context.now, creada_por_version: context.version });
  }

  return openVerified(driver, spec, context);
}
