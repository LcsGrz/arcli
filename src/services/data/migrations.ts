/**
 * Un paso del esquema de una base: lleva `user_version` a `version` (`1000 * mayor + menor`). Se corre adentro de un
 * `BEGIN IMMEDIATE`, con la versión releída adentro.
 */
export interface SqliteMigration {
  readonly version: number;
  up(exec: (sql: string) => void): void;
}
