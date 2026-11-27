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
}

/** @internal Stub de Tests primero (ARQ-12 PR 4a): lo implementa nucleo. */
export async function openSqliteConnection(
  _path: string,
  _options: SqliteConnectionOptions,
): Promise<SqliteConnection> {
  throw new Error('no implementado: stub de Tests primero (ARQ-12 PR 4a), lo implementa nucleo');
}
