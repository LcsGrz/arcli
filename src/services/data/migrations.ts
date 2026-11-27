import type { SqliteConnection } from './sqlite-driver';

/**
 * Un paso del esquema de una base: lleva `user_version` a `version` (`1000 * mayor + menor`). Se corre adentro de un
 * `BEGIN IMMEDIATE`, con la versión releída adentro.
 */
export interface SqliteMigration {
  readonly version: number;
  up(exec: (sql: string) => void): void;
}

/** Quién migra y cuándo: va a la tabla `migraciones`. */
export interface MigrationContext {
  /** ISO UTC. */
  readonly now: string;
  /** La versión de ARCLI. */
  readonly version: string;
}

/** `user_version = 1000 * mayor + menor`. Una menor solo suma; todo lo demás es una mayor. */
const MAJOR_FACTOR = 1000;

/**
 * Las tablas que tienen todas las bases: de quién es (`metadatos`: base, CUIT, entorno, cuándo y con qué versión se
 * creó) y qué pasos se le aplicaron (`migraciones`).
 */
export const DATABASE_HOUSEKEEPING_DDL = `
CREATE TABLE metadatos (clave TEXT PRIMARY KEY, valor TEXT NOT NULL) STRICT;
CREATE TABLE migraciones (esquema INTEGER PRIMARY KEY, aplicada_el TEXT NOT NULL, version_arcli TEXT NOT NULL, copia TEXT) STRICT;
`;

export function schemaMajor(version: number): number {
  return Math.floor(version / MAJOR_FACTOR);
}

/** La última versión que conocen los pasos. */
export function latestVersion(migrations: readonly SqliteMigration[]): number {
  return migrations.reduce((latest, { version }) => Math.max(latest, version), 0);
}

export function readUserVersion(connection: SqliteConnection): number {
  return Number(connection.get('PRAGMA user_version')?.user_version ?? 0);
}

/** `BEGIN IMMEDIATE`, `work` y `COMMIT`; si algo falla, `ROLLBACK` y el error sale como vino. */
export function inImmediateTransaction<T>(connection: SqliteConnection, work: () => T): T {
  connection.exec('BEGIN IMMEDIATE');

  try {
    const result = work();

    connection.exec('COMMIT');

    return result;
  } catch (error) {
    try {
      connection.exec('ROLLBACK');
    } catch {
      // SQLite ya la deshizo (un error de disco o de memoria la cierra solo): el error que importa es el de arriba.
    }

    throw error;
  }
}

/**
 * Aplica, sin abrir una transacción, los pasos posteriores a `from`, en orden: cada uno queda en `migraciones` y en
 * `user_version`. Lo usa quien ya tiene la transacción (crear la base, `migrate`).
 */
export function applyMigrations(
  connection: SqliteConnection,
  migrations: readonly SqliteMigration[],
  from: number,
  context: MigrationContext,
): void {
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (migration.version <= from) {
      continue;
    }

    migration.up((sql) => connection.exec(sql));
    connection.run(
      'INSERT INTO migraciones (esquema, aplicada_el, version_arcli, copia) VALUES (:esquema, :aplicada_el, :version_arcli, NULL)',
      { aplicada_el: context.now, esquema: migration.version, version_arcli: context.version },
    );
    // PRAGMA no acepta parámetros: el número sale de los pasos, que son código, no de una entrada.
    connection.exec(`PRAGMA user_version = ${Math.trunc(migration.version)}`);
  }
}

/**
 * Lleva la base a la última versión de los pasos, en un `BEGIN IMMEDIATE` y con la versión releída adentro: si otro
 * proceso migró mientras se esperaba, no se repite nada. Una base más nueva (otra menor) no se baja.
 */
export function migrate(
  connection: SqliteConnection,
  migrations: readonly SqliteMigration[],
  context: MigrationContext,
): void {
  if (readUserVersion(connection) >= latestVersion(migrations)) {
    return;
  }

  inImmediateTransaction(connection, () =>
    applyMigrations(connection, migrations, readUserVersion(connection), context),
  );
}
