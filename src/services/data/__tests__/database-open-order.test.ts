import { basename } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SqliteConnection } from '../sqlite-driver';

import {
  expectLocalDataError,
  inspect,
  openStore,
  temporaryDataDirectory,
  voucherRecord,
  vouchersFile,
} from './local-data.fixtures';

/**
 * El orden al abrir una base (ARQ-12, docs/architecture.md "Datos locales"), mirando lo que el adaptador le pide a la
 * conexión: un driver real con cada llamada anotada. Es lo que protege que una base de otro ARCLI o de otro programa
 * no se toque, ni con un pragma.
 */
const calls: string[] = [];

vi.mock('../sqlite-driver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sqlite-driver')>();

  return {
    ...actual,
    async loadSqliteDriver() {
      const driver = await actual.loadSqliteDriver();

      return {
        open(path: string, options: { timeoutMs: number }): SqliteConnection {
          const connection = driver.open(path, options);

          calls.push(`open ${basename(path).startsWith('.nueva-') ? 'temporal' : basename(path)}`);

          return {
            all: (sql, parameters) => (calls.push(sql), connection.all(sql, parameters)),
            close: () => (calls.push('close'), connection.close()),
            exec: (sql) => (calls.push(sql), connection.exec(sql)),
            get: (sql, parameters) => (calls.push(sql), connection.get(sql, parameters)),
            run: (sql, parameters) => (calls.push(sql), connection.run(sql, parameters)),
          };
        },
      };
    },
  };
});

beforeEach(() => {
  calls.length = 0;
});

const PRAGMAS =
  'PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA fullfsync = 1; PRAGMA trusted_schema = OFF; PRAGMA foreign_keys = ON';

/** Dónde está la primera llamada que empieza con `prefix`; falla si no está. */
function position(prefix: string): number {
  const index = calls.findIndex((call) => call.startsWith(prefix));

  expect(index, `${prefix} en ${JSON.stringify(calls)}`).toBeGreaterThanOrEqual(0);

  return index;
}

async function savedBase(): Promise<string> {
  const dataDirectory = temporaryDataDirectory();

  await openStore(dataDirectory).save(voucherRecord());
  calls.length = 0;

  return dataDirectory;
}

describe('orden al abrir una base (ARQ-12)', () => {
  it('dueño y versión, después los pragmas, quick_check, metadatos y recién ahí la consulta', async () => {
    const dataDirectory = await savedBase();

    await openStore(dataDirectory).findByCae('76123456789012');

    const order = [
      position('open comprobantes.db'),
      position('PRAGMA application_id'),
      position('PRAGMA user_version'),
      position(PRAGMAS),
      position('PRAGMA quick_check'),
      position('SELECT clave, valor FROM metadatos'),
      position('SELECT cae,'),
      position('close'),
    ];

    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  // Leer una base al día no toma el lock de escritura: no hay nada que migrar.
  it('leer una base al día no abre una transacción ni escribe', async () => {
    const dataDirectory = await savedBase();

    await openStore(dataDirectory).findByNumber({ numero: 1, puntoVenta: 2, tipo: 11 });

    expect(calls.filter((call) => /^(BEGIN|INSERT|UPDATE|PRAGMA user_version =)/.test(call))).toEqual([]);
  });

  it.each([
    ['de un ARCLI más nuevo', 'PRAGMA user_version = 2000', 'newer-version'],
    ['de otro programa', 'PRAGMA application_id = 12345', 'mismatch'],
  ])('una base %s: lee el dueño y la versión y cierra, sin un solo pragma', async (_name, change, reason) => {
    const dataDirectory = await savedBase();

    inspect(vouchersFile(dataDirectory), (database) => database.exec(change));

    await expectLocalDataError(openStore(dataDirectory).save(voucherRecord({ numero: 2 })), reason);

    expect(
      calls.every((call) => /^(open comprobantes\.db|PRAGMA (application_id|user_version)$|close)/.test(call)),
    ).toBe(true);
    expect(calls.at(-1)).toBe('close');
  });

  it('al crear, el temporal lleva los pragmas antes de la transacción y la base se abre verificada', async () => {
    await openStore(temporaryDataDirectory()).save(voucherRecord());

    const temporary = position('open temporal');

    expect(calls[temporary + 1]).toBe(PRAGMAS);
    expect(calls[temporary + 2]).toBe('BEGIN IMMEDIATE');
    expect(position('open comprobantes.db')).toBeGreaterThan(position('COMMIT'));
    expect(position('PRAGMA quick_check')).toBeGreaterThan(position('open comprobantes.db'));
  });
});
