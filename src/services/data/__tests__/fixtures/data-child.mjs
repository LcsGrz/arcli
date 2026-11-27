// Los procesos que lanza data.e2e.ts (ARQ-12 PR 4a), y a veces mata. Usan el adaptador compilado de dist/ (el que se
// publica), salvo los modos "crudos", que tocan el archivo con SQLite directo para armar el caso.
//
// Uso: node data-child.mjs <modo> <carpeta de datos o archivo> ...
// Entorno: ARCLI_TEST_DIST (la carpeta dist/), ARCLI_TEST_BARRIER (si está, espera a que exista ese archivo).
/* global process, setTimeout */
import { existsSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [mode, target, ...args] = process.argv.slice(2);
const CUIT = '20111111112';

// Síncrono en todos los sistemas: process.stdout sobre un pipe no lo es en todos.
const say = (value) => writeSync(1, `${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function waitForBarrier() {
  const barrier = process.env.ARCLI_TEST_BARRIER;

  if (!barrier) return;

  say('listo');

  while (!existsSync(barrier)) sleep(2);
}

async function openStore(options = {}) {
  const url = pathToFileURL(join(process.env.ARCLI_TEST_DIST, 'services', 'data', 'sqlite-voucher-record-store.js'));
  const { openSqliteVoucherRecordStore } = await import(url.href);

  return openSqliteVoucherRecordStore({
    clock: { now: () => new Date() },
    cuit: CUIT,
    dataDirectory: target,
    environment: 'testing',
    version: '9.9.9-test',
    ...options,
  });
}

const record = (numero) => ({
  cae: String(76_000_000_000_000 + numero),
  fecha: '2026-11-26',
  fuente: 'emitido',
  numero,
  puntoVenta: 2,
  servicio: 'wsfe',
  tipo: 11,
  totalCentavos: 100 + numero,
});

const describeError = (error) => ({ message: String(error?.message), name: error?.name, reason: error?.reason });

/** SQLite directo, sin el aviso de Node 22: solo para los modos crudos. */
function rawDatabase(file) {
  const original = process.emitWarning;

  process.emitWarning = (warning, ...rest) => {
    if (!String(warning).includes('SQLite')) Reflect.apply(original, process, [warning, ...rest]);
  };

  try {
    const sqlite = process.getBuiltinModule('node:sqlite');

    return new sqlite.DatabaseSync(file, { timeout: 5000 });
  } finally {
    process.emitWarning = original;
  }
}

const migration = (hang) => ({
  version: 1001,
  up(exec) {
    exec('ALTER TABLE comprobantes ADD COLUMN prueba TEXT');

    if (hang) {
      say('medio');
      sleep(60_000);
    }
  },
});

const modes = {
  /** guardar <carpeta> <desde> <cantidad> [espera ms]: guarda de a uno y dice cuántos y qué errores. */
  async guardar() {
    const [from, count, busyTimeoutMs] = args.map(Number);
    const store = await openStore(busyTimeoutMs ? { busyTimeoutMs } : {});
    const result = { errors: [], outcomes: {} };
    const started = Date.now();

    waitForBarrier();

    for (let numero = from; numero < from + count; numero += 1) {
      try {
        const { kind } = await store.save(record(numero));

        result.outcomes[kind] = (result.outcomes[kind] ?? 0) + 1;
      } catch (error) {
        result.errors.push(describeError(error));
      }
    }

    say({ ...result, ms: Date.now() - started });
  },

  /** confirmador <carpeta> <desde>: guarda sin parar y avisa cada número recién guardado. */
  async confirmador() {
    const store = await openStore();

    for (let numero = Number(args[0]); ; numero += 1) {
      await store.save(record(numero));
      say(String(numero));
    }
  },

  /** migrar <carpeta> <colgar: si|no> <número>: abre con una menor de prueba (1001) y guarda uno. */
  async migrar() {
    const [hang, numero] = args;
    const store = await openStore({ extraMigrations: [migration(hang === 'si')] });

    waitForBarrier();

    try {
      say({ outcome: await store.save(record(Number(numero))) });
    } catch (error) {
      say({ error: describeError(error) });
    }
  },

  /** avisos <carpeta>: guarda uno y después emite avisos que no son el de SQLite: tienen que salir. */
  async avisos() {
    await (await openStore()).save(record(1));
    process.emitWarning('otro experimento', 'ExperimentalWarning');
    process.emitWarning('SQLite otro', { type: 'DeprecationWarning' });
    process.emitWarning('aviso común');
    // Los avisos salen en el siguiente tick.
    await new Promise((resolve) => setTimeout(resolve, 50));
    say('ok');
  },

  /** sostener <archivo> <ms>: toma la base con BEGIN IMMEDIATE, avisa y la suelta a los ms. */
  sostener() {
    const database = rawDatabase(target);

    database.exec('BEGIN IMMEDIATE');
    say('tomado');
    sleep(Number(args[0]));
    database.exec('ROLLBACK');
    database.close();
    say('soltado');
  },

  /** victima <archivo>: una transacción grande que nunca termina, con el -journal caliente; la matan a la mitad. */
  victima() {
    const database = rawDatabase(target);
    const insert = database.prepare(
      "INSERT INTO eventos (tipo, ocurrido_el, version_arcli, datos) VALUES ('victima', '2026-11-26T15:00:00.000Z', 'x', :datos)",
    );

    database.exec('PRAGMA cache_size = 10; BEGIN IMMEDIATE');

    for (let index = 0; index < 300; index += 1) insert.run({ datos: JSON.stringify({ relleno: 'x'.repeat(2000) }) });

    say('medio');

    for (let index = 0; index < 1_000_000; index += 1) {
      insert.run({ datos: JSON.stringify({ relleno: 'y'.repeat(2000) }) });
    }
  },
};

await modes[mode]();
