import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { describe, expect, it, vi } from 'vitest';

import { BUSY_SLICE_MS, type NativeSqliteModule, openSqliteConnection, sqliteDriverOver } from '../sqlite-driver';
import { classifySqliteError } from '../sqlite-errors';

import { loadSqlite, temporaryDataDirectory } from './local-data.fixtures';

const sqliteError = (errcode: number, message = 'database is locked') =>
  Object.assign(new Error(message), { code: 'ERR_SQLITE_ERROR', errcode });

const isBusyTimeoutPragma = (sql: string) => sql.startsWith('PRAGMA busy_timeout');

/**
 * Un `node:sqlite` falso: cada `exec` y cada `prepare(...).get/run/all` pasa por `step`, que lanza o devuelve. El reloj
 * avanza `BUSY_SLICE_MS` cada vez que se mira, como si cada intento hubiera esperado su vuelta adentro de SQLite.
 * `busyTimeouts` es la espera de SQLite que tenía cada sentencia (la del constructor y después los `PRAGMA`).
 */
function fakeSqlite(
  step: (sql: string) => unknown,
  { isTransaction = false, oldNode = false }: { isTransaction?: boolean; oldNode?: boolean } = {},
) {
  const timeouts: number[] = [];
  const statements: { readonly busyTimeout: number; readonly sql: string }[] = [];
  let busyTimeout = 0;
  const run = (sql: string) => {
    statements.push({ busyTimeout, sql });

    return step(sql);
  };

  class Database {
    readonly isTransaction = oldNode ? undefined : isTransaction;

    constructor(_path: string, options: { readonly timeout: number }) {
      timeouts.push(options.timeout);
      busyTimeout = options.timeout;
    }

    exec(sql: string) {
      if (isBusyTimeoutPragma(sql)) {
        busyTimeout = Number(sql.split('=')[1]);

        return;
      }

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
    ['exec', 'PRAGMA journal_mode = DELETE;'],
    ['get', 'PRAGMA quick_check'],
    ['all', 'SELECT clave, valor FROM metadatos'],
    ['run', 'VACUUM INTO :destino'],
  ] as const)('sin transacción, %s (%s) tomada vuelve a probar hasta que entra', (method, sql) => {
    const { driver, statements } = fakeSqlite(busyFor(4, method === 'all' ? [] : { changes: 0 }));
    const connection = driver.open('/base.db', { timeoutMs: 5000 });

    expect(() => connection[method](sql)).not.toThrow();
    expect(statements).toHaveLength(5);
    expect(statements.every(({ busyTimeout }) => busyTimeout === BUSY_SLICE_MS)).toBe(true);
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

  // Si B da BUSY, A ya quedó hecha: repetir la cadena no es seguro. Espera una sola vez, entera, como antes de ARQ-30.
  it.each(['PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON', "INSERT INTO t (nota) VALUES ('a;b')"])(
    'un exec con varias sentencias (o un ; adentro) no se repite y espera timeoutMs adentro de SQLite: %s',
    (sql) => {
      const { driver, statements } = fakeSqlite(busyFor(1));
      const connection = driver.open('/base.db', { timeoutMs: 5000 });

      expect(() => connection.exec(sql)).toThrow('database is locked');
      expect(statements).toEqual([{ busyTimeout: 5000, sql }]);

      // Y la siguiente vuelve a las vueltas cortas.
      connection.exec('BEGIN IMMEDIATE');
      expect(statements.at(-1)).toEqual({ busyTimeout: BUSY_SLICE_MS, sql: 'BEGIN IMMEDIATE' });
    },
  );

  // Node 22.13 a 22.15 cargan node:sqlite sin `isTransaction`: si no se sabe, no se repite nada y la espera es la de
  // SQLite, entera.
  it('sin isTransaction (un Node viejo) no se repite y espera timeoutMs adentro de SQLite', () => {
    const { driver, statements } = fakeSqlite(busyFor(1), { oldNode: true });
    const connection = driver.open('/base.db', { timeoutMs: 5000 });

    expect(() => connection.exec('BEGIN IMMEDIATE')).toThrow('database is locked');
    expect(() => connection.exec('COMMIT')).not.toThrow();
    expect(statements).toEqual([
      { busyTimeout: 5000, sql: 'BEGIN IMMEDIATE' },
      { busyTimeout: 5000, sql: 'COMMIT' },
    ]);
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

/** `node:sqlite` de verdad, contando cada sentencia que se le pide a SQLite (sin los `PRAGMA busy_timeout`). */
function countingSqlite() {
  const { DatabaseSync } = loadSqlite();
  const counted = { statements: 0 };

  class Counting extends DatabaseSync {
    override exec(sql: string) {
      if (!isBusyTimeoutPragma(sql)) {
        counted.statements += 1;
      }

      super.exec(sql);
    }

    override prepare(sql: string) {
      counted.statements += 1;

      return super.prepare(sql);
    }
  }

  return { counted, driver: sqliteDriverOver({ DatabaseSync: Counting } as unknown as NativeSqliteModule) };
}

describe('sqlite-driver: la espera con SQLite de verdad (ARQ-30)', () => {
  it('otra conexión con la base tomada: espera timeoutMs en total y da locked', async () => {
    const file = join(temporaryDataDirectory('arcli-driver-busy-'), 'prueba.db');
    const holder = await openSqliteConnection(file, { timeoutMs: 1000 });
    const waiter = await openSqliteConnection(file, { timeoutMs: 300 });

    try {
      holder.exec('CREATE TABLE t (n INTEGER) STRICT');
      holder.exec('BEGIN IMMEDIATE');

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

  // `isTransaction` es lo que decide si se repite: con SQLite de verdad, prendido adentro de un BEGIN IMMEDIATE. Ahí
  // ninguna sentencia da BUSY (la base ya está reservada): para ver una de adentro tomada, un BEGIN diferido que
  // después escribe con la base reservada por otro.
  it('adentro de una transacción isTransaction está prendido y una sentencia tomada no se repite', () => {
    const file = join(temporaryDataDirectory('arcli-driver-busy-'), 'prueba.db');
    const native = new (loadSqlite().DatabaseSync)(file, { timeout: 1000 });
    const { counted, driver } = countingSqlite();
    const holder = driver.open(file, { timeoutMs: 1000 });
    const waiter = driver.open(file, { timeoutMs: 2000 });

    try {
      native.exec('CREATE TABLE t (n INTEGER) STRICT; BEGIN IMMEDIATE');
      expect((native as unknown as { isTransaction: boolean }).isTransaction).toBe(true);
      native.exec('ROLLBACK');

      holder.exec('BEGIN IMMEDIATE');
      waiter.exec('BEGIN');

      const before = counted.statements;
      const started = Date.now();

      expect(() => waiter.run('INSERT INTO t (n) VALUES (:n)', { n: 1 })).toThrow('database is locked');
      expect(counted.statements - before).toBe(1);
      // Una vuelta de SQLite, no los 2 s del driver.
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      waiter.close();
      holder.close();
      native.close();
    }
  });

  // El que espera hace rato tiene que entrar enseguida cuando el otro suelta. Con la espera de SQLite de 5 s, pasados
  // unos 230 ms mira cada 100 ms: entra en promedio unos 50 ms después. Con las vueltas, a los pocos ms (en Windows,
  // hasta unos 16 ms: lo que dura la pausa más corta). Las esperas del otro corren la suelta por todo el tick de 100 ms
  // (300 + 37 × i ms), así que con la espera de antes la mitad entra a más de 40 ms: la mediana no pasa de casualidad.
  it('el que espera hace rato entra enseguida cuando el otro suelta, sin gastar CPU', { timeout: 30_000 }, async () => {
    const file = join(temporaryDataDirectory('arcli-driver-busy-'), 'prueba.db');
    const holds = Array.from({ length: 12 }, (_, index) => 300 + ((index * 37) % 100));
    // [0]: 1 cuando el otro tomó la base, 2 cuando el que espera ya entró. [1]: cuándo soltó (ms desde el epoch).
    const state = new Int32Array(new SharedArrayBuffer(8));
    const released = new Float64Array(new SharedArrayBuffer(8));
    const setup = await openSqliteConnection(file, { timeoutMs: 1000 });

    setup.exec('CREATE TABLE t (n INTEGER) STRICT');
    setup.close();

    const worker = new Worker(
      `
      const { workerData } = require('node:worker_threads');
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
      const { file, holds, state, released } = workerData;
      const database = new DatabaseSync(file, { timeout: 1000 });
      for (const hold of holds) {
        database.exec('BEGIN IMMEDIATE');
        Atomics.store(state, 0, 1);
        Atomics.notify(state, 0);
        Atomics.wait(state, 0, 1, hold);
        // Antes de soltar: si se anotara después, el que espera podría leer la de la vuelta anterior.
        released[0] = performance.timeOrigin + performance.now();
        database.exec('ROLLBACK');
        Atomics.wait(state, 0, 1);
        Atomics.store(state, 0, 0);
        Atomics.notify(state, 0);
      }
      database.close();
      `,
      { eval: true, workerData: { file, holds, released, state } },
    );
    const exited = new Promise((resolve) => worker.once('exit', resolve));
    const waiter = await openSqliteConnection(file, { timeoutMs: 5000 });
    const delays: number[] = [];
    const cpuBefore = process.cpuUsage();
    const wallBefore = performance.now();

    try {
      for (let round = 0; round < holds.length; round += 1) {
        while (Atomics.load(state, 0) !== 1) {
          Atomics.wait(state, 0, 0, 50);
        }

        waiter.exec('BEGIN IMMEDIATE');
        delays.push(performance.timeOrigin + performance.now() - (released[0] ?? 0));
        waiter.exec('ROLLBACK');
        Atomics.store(state, 0, 2);
        Atomics.notify(state, 0);

        while (Atomics.load(state, 0) === 2) {
          Atomics.wait(state, 0, 2, 50);
        }
      }
    } finally {
      waiter.close();
      await exited;
    }

    const cpu = process.cpuUsage(cpuBefore);
    const wall = performance.now() - wallBefore;
    const median = [...delays].sort((a, b) => a - b)[delays.length / 2] ?? Number.POSITIVE_INFINITY;

    expect(delays).toHaveLength(holds.length);
    expect(median, `entró a ${delays.map(Math.round).join(', ')} ms de que soltara`).toBeLessThan(30);
    // Esperar es dormir adentro de SQLite: un bucle que repite sin dormir gastaría una CPU entera todo ese rato.
    expect((cpu.user + cpu.system) / 1000).toBeLessThan(wall * 0.5);
  });
});
