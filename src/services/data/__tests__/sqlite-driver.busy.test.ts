import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { BUSY_SLICE_MS, type NativeSqliteModule, openSqliteConnection, sqliteDriverOver } from '../sqlite-driver';
import { classifySqliteError } from '../sqlite-errors';

import { temporaryDataDirectory } from './local-data.fixtures';

const sqliteError = (errcode: number, message = 'database is locked') =>
  Object.assign(new Error(message), { code: 'ERR_SQLITE_ERROR', errcode });

/**
 * Un `node:sqlite` falso: cada `exec` y cada `prepare(...).get/run/all` pasa por `step`, que lanza o devuelve. El reloj
 * avanza `BUSY_SLICE_MS` cada vez que se mira, como si cada intento hubiera esperado su vuelta adentro de SQLite.
 */
function fakeSqlite(step: (sql: string) => unknown, { isTransaction = false } = {}) {
  const timeouts: number[] = [];
  const statements: string[] = [];
  const run = (sql: string) => {
    statements.push(sql);

    return step(sql);
  };

  class Database {
    readonly isTransaction = isTransaction;

    constructor(_path: string, options: { readonly timeout: number }) {
      timeouts.push(options.timeout);
    }

    exec(sql: string) {
      run(sql);
    }

    prepare(sql: string) {
      return { all: () => run(sql), get: () => run(sql), run: () => run(sql) };
    }

    close() {}
  }

  let clock = 0;
  const driver = sqliteDriverOver({ DatabaseSync: Database } as unknown as NativeSqliteModule, () => {
    clock += BUSY_SLICE_MS;

    return clock;
  });

  return { driver, statements, timeouts };
}

/** Lanza SQLITE_BUSY las primeras `times` veces y después devuelve `value`. */
function busyFor(times: number, value: unknown = { changes: 1 }) {
  let calls = 0;

  return () => {
    calls += 1;

    if (calls <= times) {
      throw sqliteError(5);
    }

    return value;
  };
}

// ARQ-30: con un solo `busy_timeout` de 5 s, SQLite mira la base cada vez más espaciado (hasta cada 100 ms) y el que
// espera hace rato pierde contra los que llegan: en el CI de Windows un guardado de 8 procesos × 100 perdió sus tres
// intentos. El driver espera de a vueltas cortas, hasta la misma espera total.
describe('sqlite-driver: la espera cuando otro proceso tiene la base (ARQ-30)', () => {
  it('a SQLite le pide vueltas cortas, no la espera entera', () => {
    const { driver, timeouts } = fakeSqlite(() => undefined);

    driver.open('/base.db', { timeoutMs: 5000 });
    driver.open('/turno.db', { timeoutMs: 3 });

    expect(BUSY_SLICE_MS).toBeLessThanOrEqual(10);
    expect(timeouts).toEqual([BUSY_SLICE_MS, 3]);
  });

  it.each([
    ['exec', 'BEGIN IMMEDIATE'],
    ['get', 'PRAGMA quick_check'],
    ['all', 'SELECT clave, valor FROM metadatos'],
    ['run', 'VACUUM INTO :destino'],
  ] as const)('sin transacción, %s (%s) tomada vuelve a probar hasta que entra', (method, sql) => {
    const { driver, statements } = fakeSqlite(busyFor(4, method === 'all' ? [] : { changes: 0 }));
    const connection = driver.open('/base.db', { timeoutMs: 5000 });

    expect(() => connection[method](sql)).not.toThrow();
    expect(statements).toHaveLength(5);
  });

  it('tomada más que la espera total: sale SQLITE_BUSY (locked) después de timeoutMs, no antes', () => {
    const { driver, statements } = fakeSqlite(busyFor(Number.POSITIVE_INFINITY));
    const connection = driver.open('/base.db', { timeoutMs: 300 });
    let error: unknown;

    try {
      connection.exec('BEGIN IMMEDIATE');
    } catch (caught) {
      error = caught;
    }

    expect(classifySqliteError(error)).toBe('locked');
    // Una vuelta de 10 ms por intento hasta pasar los 300 ms del reloj falso.
    expect(statements).toHaveLength(300 / BUSY_SLICE_MS);
  });

  it('adentro de una transacción, una sentencia tomada sale enseguida: la deshace quien la abrió', () => {
    const { driver, statements } = fakeSqlite(busyFor(1), { isTransaction: true });
    const connection = driver.open('/base.db', { timeoutMs: 5000 });

    expect(() => connection.run('INSERT INTO comprobantes (cae) VALUES (:cae)', { cae: '76' })).toThrow(
      'database is locked',
    );
    expect(statements).toHaveLength(1);
  });

  it('el COMMIT tomado sí se repite: con BUSY la transacción queda abierta', () => {
    const { driver, statements } = fakeSqlite(busyFor(3), { isTransaction: true });
    const connection = driver.open('/base.db', { timeoutMs: 5000 });

    expect(() => connection.exec('COMMIT')).not.toThrow();
    expect(statements).toHaveLength(4);
  });

  it.each([
    ['SQLITE_LOCKED (6)', sqliteError(6, 'database table is locked')],
    ['SQLITE_CORRUPT (11)', sqliteError(11, 'database disk image is malformed')],
    ['un error que no es de SQLite', new TypeError('otro')],
  ])('%s no se repite', (_name, thrown) => {
    const step = vi.fn(() => {
      throw thrown;
    });
    const { driver } = fakeSqlite(step);
    const connection = driver.open('/base.db', { timeoutMs: 5000 });

    expect(() => connection.get('PRAGMA user_version')).toThrow(thrown);
    expect(step).toHaveBeenCalledTimes(1);
  });
});

describe('sqlite-driver: la espera con SQLite de verdad (ARQ-30)', () => {
  it('otra conexión con la base tomada: espera timeoutMs en total y da locked', async () => {
    const file = join(temporaryDataDirectory('arcli-driver-busy-'), 'prueba.db');
    const holder = await openSqliteConnection(file, { timeoutMs: 1000 });
    const waiter = await openSqliteConnection(file, { timeoutMs: 300 });

    try {
      holder.exec('CREATE TABLE t (n INTEGER) STRICT; BEGIN IMMEDIATE');

      const started = Date.now();
      let error: unknown;

      try {
        waiter.exec('BEGIN IMMEDIATE');
      } catch (caught) {
        error = caught;
      }

      expect(classifySqliteError(error)).toBe('locked');
      expect(Date.now() - started).toBeGreaterThanOrEqual(300);

      holder.exec('ROLLBACK');
      waiter.exec('BEGIN IMMEDIATE');
      waiter.exec('ROLLBACK');
    } finally {
      waiter.close();
      holder.close();
    }
  });
});
