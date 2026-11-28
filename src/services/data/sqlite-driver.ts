/**
 * El único archivo que carga `node:sqlite` (ARQ-12): con `await import` y el aviso experimental de Node 22 oculto
 * solo mientras carga, `Database ?? DatabaseSync`. Lo demás de src/services/data habla con la base por acá.
 */
import { pathToFileURL } from 'node:url';

import { isSqliteBusy } from './sqlite-errors';

/** Lo que se puede pasar como parámetro. `undefined` no: en Node 26 no lanza y se guardaría NULL sin avisar. */
type SqliteValue = bigint | number | string | Uint8Array | null;

/** Parámetros siempre con nombre (`:cae`), nunca por posición. */
export type SqliteParameters = Readonly<Record<string, SqliteValue>>;

type SqliteRow = Readonly<Record<string, SqliteValue>>;

/** Una conexión abierta, con `defensive` prendido. */
export interface SqliteConnection {
  /**
   * Una sentencia sin parámetros. Con varias separadas por `;` corre igual, pero si otro proceso tiene la base no se
   * repite: espera una sola vez, todo `timeoutMs` adentro de SQLite (las primeras ya pueden haber quedado hechas).
   */
  exec(sql: string): void;
  /** Lanza `TypeError` si algún parámetro es `undefined`, antes de pasarlo a SQLite. */
  run(sql: string, parameters?: SqliteParameters): { readonly changes: number };
  get(sql: string, parameters?: SqliteParameters): SqliteRow | undefined;
  all(sql: string, parameters?: SqliteParameters): readonly SqliteRow[];
  close(): void;
}

export interface SqliteConnectionOptions {
  /**
   * Cuánto espera cada sentencia, en total, si otro proceso tiene la base, en ms. Se espera de a vueltas cortas
   * (`BUSY_SLICE_MS`), no con un solo `busy_timeout` así de largo.
   */
  readonly timeoutMs: number;
  /** Solo para leer una copia (nunca la base): no deshace un `-journal` ni cambia nada del archivo. */
  readonly readOnly?: boolean;
  /**
   * Que no la cree si no está (`SQLITE_CANTOPEN`). Sin esto SQLite crea un archivo vacío: si otro proceso movió la
   * base entre que se miró y se abrió (apartar una dañada), quedaría una vacía en su lugar.
   */
  readonly mustExist?: boolean;
}

/**
 * Con `mustExist`, la ruta va como URI `file:` con `mode=rw` (o `ro`), que SQLite abre sin crear. Una ruta UNC de
 * Windows (`\\servidor\carpeta`) queda como ruta: en una URI de SQLite no puede llevar servidor.
 */
function locationOf(path: string, { mustExist = false, readOnly = false }: SqliteConnectionOptions): string {
  if (!mustExist || path.startsWith('\\\\')) {
    return path;
  }

  const url = pathToFileURL(path);

  url.searchParams.set('mode', readOnly ? 'ro' : 'rw');

  return url.href;
}

/** Abre conexiones sin esperar: el módulo ya está cargado. */
export interface SqliteDriver {
  open(path: string, options: SqliteConnectionOptions): SqliteConnection;
}

// Lo que se usa de node:sqlite, con tipos propios: `defensive` y `Database` no están en el @types/node del proyecto
// (22), y no se sube por esto.
interface NativeStatement {
  run(parameters: SqliteParameters): { readonly changes: bigint | number };
  get(parameters: SqliteParameters): unknown;
  all(parameters: SqliteParameters): unknown[];
}

interface NativeDatabase {
  /** Si hay una transacción abierta. Desde Node 22.16: en 22.13 a 22.15 no está (`undefined`). */
  readonly isTransaction?: boolean;
  exec(sql: string): void;
  prepare(sql: string): NativeStatement;
  close(): void;
}

type NativeDatabaseConstructor = new (
  path: string,
  options: { readonly defensive: boolean; readonly readOnly: boolean; readonly timeout: number },
) => NativeDatabase;

/** @internal Exportado para los tests del driver, que pasan un `node:sqlite` falso. */
export interface NativeSqliteModule {
  /** El nombre nuevo (Node 26 en adelante); `DatabaseSync` queda como alias. */
  readonly Database?: NativeDatabaseConstructor;
  readonly DatabaseSync: NativeDatabaseConstructor;
}

/**
 * El aviso de Node 22 al cargar `node:sqlite` ("SQLite is an experimental feature…"), en las dos formas de
 * `emitWarning`: con el tipo como texto o en las opciones. Cualquier otro aviso sale.
 *
 * @internal Exportada para sus tests: en Node 24 y 26 el aviso no existe y solo el e2e sobre Node 22 la vería.
 */
export function isSqliteExperimentalWarning(warning: unknown, typeOrOptions: unknown): boolean {
  const type =
    typeof typeOrOptions === 'string'
      ? typeOrOptions
      : ((typeOrOptions as { type?: unknown } | undefined)?.type ??
        (warning instanceof Error ? warning.name : undefined));
  const text = warning instanceof Error ? warning.message : String(warning);

  return type === 'ExperimentalWarning' && text.startsWith('SQLite ');
}

async function importQuietly(): Promise<NativeSqliteModule> {
  const original = process.emitWarning;

  process.emitWarning = function (this: unknown, warning: unknown, ...rest: unknown[]) {
    if (!isSqliteExperimentalWarning(warning, rest[0])) {
      Reflect.apply(original, process, [warning, ...rest]);
    }
  } as typeof process.emitWarning;

  try {
    return (await import('node:sqlite')) as unknown as NativeSqliteModule;
  } finally {
    process.emitWarning = original;
  }
}

function checkedParameters(parameters: SqliteParameters = {}): SqliteParameters {
  for (const [name, value] of Object.entries(parameters)) {
    if (value === undefined) {
      throw new TypeError(`El parámetro :${name} es undefined: pasá null si el dato no se sabe.`);
    }
  }

  return parameters;
}

/**
 * Cada espera adentro de SQLite (`busy_timeout`), en ms (ARQ-30). La de SQLite es creciente: mira la base a 1, 2, 5,
 * 10, 15... ms y, pasados unos 230 ms, cada 100 ms. Con un `busy_timeout` de 5 s, el que espera hace rato mira cada
 * 100 ms y el que recién llega, enseguida: con varios procesos guardando sin parar, el que llega gana el hueco y el
 * que espera puede perderlos todos. Medido el 27/11 en macOS con 8 procesos × 100 guardados: mediana de 16 ms por
 * guardado y máximo de 9 s, con un `BEGIN IMMEDIATE` que agotó los 5 s; en el CI de Windows, más lento, uno perdió los
 * 3 intentos. Con vueltas de 10 ms (pausas de 1, 2, 5 y 2 ms) el que espera vuelve a mirar enseguida, y la espera
 * total sigue siendo `timeoutMs`, medida con el reloj. En Windows cada pausa dura al menos lo que el reloj del sistema
 * (unos 15,6 ms), así que una vuelta puede durar unos 60 ms: igual mira cada unos 16 ms, no cada 100.
 */
export const BUSY_SLICE_MS = 10;

/** Una sola sentencia: sin `;` salvo al final. Ante la duda (un `;` adentro de un texto) cuenta como varias. */
const isSingleStatement = (sql: string) => !sql.trim().replace(/;$/, '').includes(';');

const isCommit = (sql: string) => /^\s*(?:COMMIT|END)\b/i.test(sql);

type Patience = 'repeat' | 'in-transaction' | 'wait-whole';

/**
 * Cómo espera una sentencia si otro proceso tiene la base:
 *
 * - `repeat`: SQLite espera una vuelta y el driver la repite hasta `timeoutMs`. Sin una transacción abierta (una
 *   sentencia sola que da BUSY no cambió nada; `BEGIN` tampoco) y en un `COMMIT`, que con BUSY deja la transacción
 *   abierta para reintentarlo (https://www.sqlite.org/lang_transaction.html).
 * - `in-transaction`: adentro de un `BEGIN IMMEDIATE` no se repite (la deshace quien la abrió) y espera solo una vuelta.
 *   Ahí la base ya está reservada y el único BUSY posible es el de volcar la caché al disco mientras otro lee, que
 *   SQLite no devuelve (agranda la caché y sigue): una espera larga solo lo hace más lento (medido el 28/11 con 200
 *   inserts de 4 KiB, `cache_size = 1` y otro leyendo: 71 s con 300 ms de espera, 3 s con 10 ms, sin error en los dos).
 * - `wait-whole`: varias sentencias en un `exec` (si B da BUSY, A ya se confirmó: repetir la cadena no es seguro), o un
 *   Node sin `isTransaction`: una sola espera de SQLite de `timeoutMs`, como antes de ARQ-30.
 */
function patienceOf(database: NativeDatabase, sql: string, multiple: boolean): Patience {
  if (typeof database.isTransaction !== 'boolean') {
    return 'wait-whole';
  }

  if (database.isTransaction) {
    return isCommit(sql) ? 'repeat' : 'in-transaction';
  }

  return multiple ? 'wait-whole' : 'repeat';
}

function connectionOver(database: NativeDatabase, timeoutMs: number, now: () => number): SqliteConnection {
  const slice = Math.min(timeoutMs, BUSY_SLICE_MS);
  // Se abre con una vuelta (`sqliteDriverOver`). El `PRAGMA busy_timeout` no toma la base ni escribe nada.
  let busyTimeout = slice;
  const setBusyTimeout = (ms: number) => {
    if (busyTimeout !== ms) {
      database.exec(`PRAGMA busy_timeout = ${Math.trunc(ms)}`);
      busyTimeout = ms;
    }
  };

  // Sin `isTransaction` (Node 22.13 a 22.15) no se sabe cuándo es seguro repetir: la espera entera, siempre.
  if (typeof database.isTransaction !== 'boolean') {
    setBusyTimeout(timeoutMs);
  }

  function patient<T>(sql: string, statement: () => T, multiple = false): T {
    const patience = patienceOf(database, sql, multiple);

    if (patience === 'wait-whole') {
      setBusyTimeout(timeoutMs);

      try {
        return statement();
      } finally {
        if (typeof database.isTransaction === 'boolean') {
          setBusyTimeout(slice);
        }
      }
    }

    if (patience === 'in-transaction') {
      return statement();
    }

    for (const deadline = now() + timeoutMs; ;) {
      try {
        return statement();
      } catch (error) {
        if (!isSqliteBusy(error) || now() >= deadline) {
          throw error;
        }
      }
    }
  }

  return {
    all: (sql, parameters) =>
      patient(sql, () => database.prepare(sql).all(checkedParameters(parameters))).map((row) => ({
        ...(row as SqliteRow),
      })),
    close: () => database.close(),
    exec: (sql) => patient(sql, () => database.exec(sql), !isSingleStatement(sql)),
    get(sql, parameters) {
      const row = patient(sql, () => database.prepare(sql).get(checkedParameters(parameters)));

      return row === undefined ? undefined : { ...(row as SqliteRow) };
    },
    run(sql, parameters) {
      const { changes } = patient(sql, () => database.prepare(sql).run(checkedParameters(parameters)));

      return { changes: Number(changes) };
    },
  };
}

/**
 * El driver sobre un `node:sqlite` ya cargado.
 *
 * @internal Exportado para los tests, que pasan un módulo y un reloj falsos; el adaptador abre con `loadSqliteDriver`.
 */
export function sqliteDriverOver(sqlite: NativeSqliteModule, now: () => number = Date.now): SqliteDriver {
  const Database = sqlite.Database ?? sqlite.DatabaseSync;

  return {
    open: (path, options) =>
      connectionOver(
        new Database(locationOf(path, options), {
          defensive: true,
          readOnly: options.readOnly ?? false,
          timeout: Math.min(options.timeoutMs, BUSY_SLICE_MS),
        }),
        options.timeoutMs,
        now,
      ),
  };
}

let loading: Promise<SqliteDriver> | undefined;

/** Carga `node:sqlite` una vez por proceso. Si falla, el siguiente intento vuelve a probar. */
export function loadSqliteDriver(): Promise<SqliteDriver> {
  loading ??= importQuietly().then(
    (sqlite) => sqliteDriverOver(sqlite),
    (error: unknown) => {
      loading = undefined;
      throw error;
    },
  );

  return loading;
}

/** @internal Lo usan los tests del driver; el adaptador abre con `loadSqliteDriver`. */
export async function openSqliteConnection(path: string, options: SqliteConnectionOptions): Promise<SqliteConnection> {
  return (await loadSqliteDriver()).open(path, options);
}
