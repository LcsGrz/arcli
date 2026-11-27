import type { LocalDataErrorReason } from '../../modules/local-data/local-data-error';

/** Lo que dice un error de SQLite, por su código base (`errcode & 0xff`): una razón de `LocalDataError` o unicidad. */
export type SqliteErrorKind =
  Extract<LocalDataErrorReason, 'damaged' | 'disk-full' | 'locked' | 'read-only' | 'unavailable'> | 'unique';

/** Los códigos base de SQLite (https://www.sqlite.org/rescode.html) que no son errores de programación. */
const KIND_BY_PRIMARY_CODE: ReadonlyMap<number, SqliteErrorKind> = new Map([
  [5, 'locked'], // SQLITE_BUSY (261 BUSY_RECOVERY, 517 BUSY_SNAPSHOT)
  [6, 'locked'], // SQLITE_LOCKED (262 LOCKED_SHAREDCACHE)
  [8, 'read-only'], // SQLITE_READONLY (1032 READONLY_DBMOVED, 1544 READONLY_DIRECTORY)
  [11, 'damaged'], // SQLITE_CORRUPT
  [13, 'disk-full'], // SQLITE_FULL
  [14, 'unavailable'], // SQLITE_CANTOPEN (526 CANTOPEN_CONVPATH)
  [19, 'unique'], // SQLITE_CONSTRAINT (2067 CONSTRAINT_UNIQUE, 1555 CONSTRAINT_PRIMARYKEY)
  [26, 'damaged'], // SQLITE_NOTADB
]);

/**
 * Por código base: 5 y 6 → `locked`; 11 y 26 → `damaged`; 14 → `unavailable`; 8 → `read-only`; 13 → `disk-full`;
 * 19 → `unique`. `undefined` si no es un error de SQLite o el código no está en la lista. El driver de Node los lanza con
 * `code: 'ERR_SQLITE_ERROR'` y el código extendido en `errcode`.
 */
export function classifySqliteError(error: unknown): SqliteErrorKind | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const { code, errcode } = error as Error & { code?: unknown; errcode?: unknown };

  if (code !== 'ERR_SQLITE_ERROR' || typeof errcode !== 'number') {
    return undefined;
  }

  return KIND_BY_PRIMARY_CODE.get(errcode & 0xff);
}
