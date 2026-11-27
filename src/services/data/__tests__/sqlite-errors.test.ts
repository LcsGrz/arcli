import { describe, expect, it } from 'vitest';

import { classifySqliteError } from '../sqlite-errors';

/** Como los lanza node:sqlite: `code` del error de Node y `errcode` extendido de SQLite. */
function sqliteError(errcode: number, errstr = 'error de prueba'): Error {
  return Object.assign(new Error(errstr), { code: 'ERR_SQLITE_ERROR', errcode, errstr });
}

describe('classifySqliteError (ARQ-12): por el código base, no el extendido', () => {
  // Los extendidos salen de lo medido en el CI del 25/11: 526 es CANTOPEN_CONVPATH (14), 1032 READONLY_DBMOVED y 1544
  // READONLY_DIRECTORY (8), 261 BUSY_RECOVERY (5), 2067 CONSTRAINT_UNIQUE y 1555 CONSTRAINT_PRIMARYKEY (19).
  it.each([
    [526, 'unavailable'],
    [14, 'unavailable'],
    [1032, 'read-only'],
    [1544, 'read-only'],
    [8, 'read-only'],
    [261, 'locked'],
    [5, 'locked'],
    [6, 'locked'],
    [262, 'locked'],
    // SQLITE_IOERR y sus extendidos de lectura, escritura y fsync (revisión del 27/11).
    [10, 'unavailable'],
    [266, 'unavailable'],
    [778, 'unavailable'],
    [1034, 'unavailable'],
    [11, 'damaged'],
    [26, 'damaged'],
    [13, 'disk-full'],
    [2067, 'unique'],
    [1555, 'unique'],
  ])('%i es %s', (errcode, kind) => {
    expect(classifySqliteError(sqliteError(errcode))).toBe(kind);
  });

  it('un error que no es de SQLite no se clasifica', () => {
    expect(classifySqliteError(new Error('otro'))).toBeUndefined();
    expect(classifySqliteError(Object.assign(new Error('fs'), { code: 'EACCES', errno: -13 }))).toBeUndefined();
    expect(classifySqliteError('texto')).toBeUndefined();
    expect(classifySqliteError(undefined)).toBeUndefined();
    // Un `errcode` suelto no alcanza: tiene que ser un error de node:sqlite, con el código como número.
    expect(classifySqliteError(Object.assign(new Error('otro'), { errcode: 5 }))).toBeUndefined();
    expect(classifySqliteError(Object.assign(new Error('otro'), { code: 'ERR_SQLITE_ERROR', errcode: '5' }))).toBe(
      undefined,
    );
  });

  it('un código de SQLite fuera de la lista no se clasifica', () => {
    // 1 SQLITE_ERROR (un SQL mal escrito) y 21 SQLITE_MISUSE: errores de programación, no de la base.
    expect(classifySqliteError(sqliteError(1))).toBeUndefined();
    expect(classifySqliteError(sqliteError(21))).toBeUndefined();
  });
});
