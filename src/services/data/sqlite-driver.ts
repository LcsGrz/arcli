/**
 * El único archivo que carga `node:sqlite` (ARQ-12): con `await import` y el aviso experimental de Node 22 oculto
 * solo mientras carga, `Database ?? DatabaseSync`. Lo demás de src/services/data habla con la base por acá.
 */

/** Lo que se puede pasar como parámetro. `undefined` no: en Node 26 no lanza y se guardaría NULL sin avisar. */
type SqliteValue = bigint | number | string | Uint8Array | null;

/** Parámetros siempre con nombre (`:cae`), nunca por posición. */
export type SqliteParameters = Readonly<Record<string, SqliteValue>>;

type SqliteRow = Readonly<Record<string, SqliteValue>>;

/** Una conexión abierta, con `defensive` prendido. */
export interface SqliteConnection {
  exec(sql: string): void;
  /** Lanza `TypeError` si algún parámetro es `undefined`, antes de pasarlo a SQLite. */
  run(sql: string, parameters?: SqliteParameters): { readonly changes: number };
  get(sql: string, parameters?: SqliteParameters): SqliteRow | undefined;
  all(sql: string, parameters?: SqliteParameters): readonly SqliteRow[];
  close(): void;
}

export interface SqliteConnectionOptions {
  /** La espera de SQLite cuando otro proceso tiene la base (`busy_timeout`), en ms. */
  readonly timeoutMs: number;
  /** Solo para leer una copia (nunca la base): no deshace un `-journal` ni cambia nada del archivo. */
  readonly readOnly?: boolean;
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
  exec(sql: string): void;
  prepare(sql: string): NativeStatement;
  close(): void;
}

type NativeDatabaseConstructor = new (
  path: string,
  options: { readonly defensive: boolean; readonly readOnly: boolean; readonly timeout: number },
) => NativeDatabase;

interface NativeSqliteModule {
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

function connectionOver(database: NativeDatabase): SqliteConnection {
  return {
    all: (sql, parameters) =>
      database
        .prepare(sql)
        .all(checkedParameters(parameters))
        .map((row) => ({ ...(row as SqliteRow) })),
    close: () => database.close(),
    exec: (sql) => database.exec(sql),
    get(sql, parameters) {
      const row = database.prepare(sql).get(checkedParameters(parameters));

      return row === undefined ? undefined : { ...(row as SqliteRow) };
    },
    run(sql, parameters) {
      const { changes } = database.prepare(sql).run(checkedParameters(parameters));

      return { changes: Number(changes) };
    },
  };
}

let loading: Promise<SqliteDriver> | undefined;

/** Carga `node:sqlite` una vez por proceso. Si falla, el siguiente intento vuelve a probar. */
export function loadSqliteDriver(): Promise<SqliteDriver> {
  loading ??= importQuietly().then(
    (sqlite): SqliteDriver => {
      const Database = sqlite.Database ?? sqlite.DatabaseSync;

      return {
        open: (path, { readOnly = false, timeoutMs }) =>
          connectionOver(new Database(path, { defensive: true, readOnly, timeout: timeoutMs })),
      };
    },
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
