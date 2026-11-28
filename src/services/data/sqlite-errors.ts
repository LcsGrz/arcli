import type { LocalDataErrorReason } from '../../modules/local-data/local-data-error';

/** Lo que dice un error de SQLite, por su código base (`errcode & 0xff`): una razón de `LocalDataError` o unicidad. */
export type SqliteErrorKind =
  Extract<LocalDataErrorReason, 'damaged' | 'disk-full' | 'locked' | 'read-only' | 'unavailable'> | 'unique';

/** Los códigos base de SQLite (https://www.sqlite.org/rescode.html) que no son errores de programación. */
const KIND_BY_PRIMARY_CODE: ReadonlyMap<number, SqliteErrorKind> = new Map([
  [5, 'locked'], // SQLITE_BUSY (261 BUSY_RECOVERY, 517 BUSY_SNAPSHOT)
  [6, 'locked'], // SQLITE_LOCKED (262 LOCKED_SHAREDCACHE)
  [8, 'read-only'], // SQLITE_READONLY (1032 READONLY_DBMOVED, 1544 READONLY_DIRECTORY)
  // SQLITE_IOERR, con todos sus extendidos (778 IOERR_WRITE, 1034 IOERR_FSYNC...): el disco o la red fallaron. No es
  // `disk-full` ni con los de escritura: sin lugar, SQLite da SQLITE_FULL (13), y un IOERR_WRITE también es un disco
  // que se desconectó o una carpeta de red que se cayó.
  [10, 'unavailable'],
  [11, 'damaged'], // SQLITE_CORRUPT
  [13, 'disk-full'], // SQLITE_FULL
  [14, 'unavailable'], // SQLITE_CANTOPEN (526 CANTOPEN_CONVPATH)
  [19, 'unique'], // SQLITE_CONSTRAINT (2067 CONSTRAINT_UNIQUE, 1555 CONSTRAINT_PRIMARYKEY)
  [26, 'damaged'], // SQLITE_NOTADB
]);

/** El código base de un error de SQLite que lanza el driver de Node (`code: 'ERR_SQLITE_ERROR'`, `errcode`). */
function primaryCodeOf(error: unknown): number | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const { code, errcode } = error as Error & { code?: unknown; errcode?: unknown };

  return code === 'ERR_SQLITE_ERROR' && typeof errcode === 'number' ? errcode & 0xff : undefined;
}

/**
 * SQLITE_BUSY (5): otra conexión tiene la base y se puede volver a probar. SQLITE_LOCKED (6) no: es un conflicto
 * adentro de la misma conexión, que esperar no arregla.
 */
export function isSqliteBusy(error: unknown): boolean {
  return primaryCodeOf(error) === 5;
}

/**
 * Por código base: 5 y 6 → `locked`; 11 y 26 → `damaged`; 10 y 14 → `unavailable`; 8 → `read-only`; 13 → `disk-full`;
 * 19 → `unique`. `undefined` si no es un error de SQLite o el código no está en la lista. El driver de Node los lanza con
 * `code: 'ERR_SQLITE_ERROR'` y el código extendido en `errcode`.
 */
export function classifySqliteError(error: unknown): SqliteErrorKind | undefined {
  const primary = primaryCodeOf(error);

  return primary === undefined ? undefined : KIND_BY_PRIMARY_CODE.get(primary);
}
