import { createHash } from 'node:crypto';
import { closeSync, fstatSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, expect } from 'vitest';

import type { Clock } from '../../../lib/time/clock';
import type { ArcliEnvironment } from '../../../modules/config/config.schemas';
import type { VoucherRecord, VoucherRecordStore } from '../../../modules/vouchers/voucher-record-store';
import { openSqliteVoucherRecordStore, type SqliteVoucherRecordStoreOptions } from '../sqlite-voucher-record-store';

/**
 * Lo compartido por los tests de los datos locales (ARQ-12 PR 4a): carpetas temporales, un reloj fijo, comprobantes
 * ficticios y una conexión cruda a SQLite para mirar lo que quedó en el archivo, sin pasar por el código probado.
 */

/** CUITs de prueba (ficticios, con dígito verificador válido). */
export const CUIT = '20111111112';
export const OTHER_CUIT = '20333333334';
export const VERSION = '9.9.9-test';
export const NOW = '2026-11-26T15:00:00.000Z';
/** `'arcl'`: el `application_id` de las bases de ARCLI. */
export const APPLICATION_ID = 1634886508;
export const SCHEMA_V1 = 1000;

/** El sistema no aplica los permisos POSIX (Windows) o el usuario los saltea (root). */
export const withPermissions = process.platform !== 'win32' && process.getuid?.() !== 0;

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

/** Una carpeta de datos vacía, que se borra al terminar el test. */
export function temporaryDataDirectory(prefix = 'arcli-datos-'): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));

  directories.push(directory);

  return directory;
}

/** Un reloj que se puede adelantar. */
export function movableClock(start = NOW): Clock & { set(iso: string): void } {
  let now = new Date(start);

  return {
    now: () => new Date(now),
    set(iso) {
      now = new Date(iso);
    },
  };
}

/** Una Factura C ficticia de A/B/C; cada test cambia lo que le importa. */
export function voucherRecord(overrides: Partial<VoucherRecord> = {}): VoucherRecord {
  return {
    cae: '76123456789012',
    fecha: '2026-11-26',
    fuente: 'emitido',
    numero: 1,
    puntoVenta: 2,
    servicio: 'wsfe',
    tipo: 11,
    totalCentavos: 1_210_050,
    ...overrides,
  };
}

export function openStore(
  dataDirectory: string,
  options: Partial<Omit<SqliteVoucherRecordStoreOptions, 'dataDirectory'>> = {},
): VoucherRecordStore {
  return openSqliteVoucherRecordStore({
    clock: movableClock(),
    cuit: CUIT,
    environment: 'testing',
    version: VERSION,
    ...options,
    dataDirectory,
  });
}

export function vouchersFile(dataDirectory: string, cuit = CUIT, environment: ArcliEnvironment = 'testing'): string {
  return join(dataDirectory, 'datos', cuit, environment, 'comprobantes.db');
}

export function clientsFile(dataDirectory: string, cuit = CUIT): string {
  return join(dataDirectory, 'datos', cuit, 'clientes.db');
}

type SqliteModule = typeof import('node:sqlite');

let sqlite: SqliteModule | undefined;

/** `node:sqlite` sin el aviso experimental de Node 22 en la salida de los tests. */
function loadSqlite(): SqliteModule {
  if (sqlite) {
    return sqlite;
  }

  const original = process.emitWarning;

  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (String(warning).includes('SQLite')) {
      return;
    }

    Reflect.apply(original, process, [warning, ...rest]);
  }) as typeof process.emitWarning;

  try {
    sqlite = process.getBuiltinModule('node:sqlite') as SqliteModule;
  } finally {
    process.emitWarning = original;
  }

  return sqlite;
}

/** Abre el archivo con SQLite crudo (sin pragmas), corre `use` y siempre cierra: en Windows, abierto no se borra. */
export function inspect<T>(file: string, use: (database: DatabaseSync) => T, options: { readOnly?: boolean } = {}): T {
  const database = new (loadSqlite().DatabaseSync)(file, { timeout: 5000, ...options });

  try {
    return use(database);
  } finally {
    database.close();
  }
}

/** El primer valor de la primera fila. */
export function scalar(database: DatabaseSync, sql: string): unknown {
  return Object.values(database.prepare(sql).get() ?? {})[0];
}

/** Una base de SQLite en memoria con el DDL de un archivo, para comparar estructuras. */
export function inMemory<T>(ddl: string, use: (database: DatabaseSync) => T): T {
  const database = new (loadSqlite().DatabaseSync)(':memory:');

  try {
    database.exec(ddl);

    return use(database);
  } finally {
    database.close();
  }
}

/** Contenido (hash) y fecha de modificación: lo que cambia si alguien escribió el archivo. */
export function fingerprint(file: string): { readonly hash: string; readonly mtimeMs: number; readonly size: number } {
  // Por el descriptor: el contenido y la fecha son del mismo archivo abierto, no de dos miradas a la ruta.
  const descriptor = openSync(file, 'r');

  try {
    const stats = fstatSync(descriptor);

    return {
      hash: createHash('sha256').update(readFileSync(descriptor)).digest('hex'),
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    };
  } finally {
    closeSync(descriptor);
  }
}

export function permissions(path: string): number {
  return statSync(path).mode & 0o777;
}

/** Lo que dejó SQLite al lado de la base: `-journal`, `-wal`, `-shm`, listando la carpeta. */
export function companions(file: string): string[] {
  const names = new Set(readdirSync(dirname(file)));

  return ['-journal', '-wal', '-shm'].filter((suffix) => names.has(`${basename(file)}${suffix}`));
}

/** La promesa rechaza con `LocalDataError` y esa razón. */
export async function expectLocalDataError(promise: Promise<unknown>, reason: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: 'LocalDataError', reason });
}
