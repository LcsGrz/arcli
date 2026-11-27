import * as fs from 'node:fs';
import { readdirSync, truncateSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadSqliteDriver, type SqliteConnection } from '../sqlite-driver';

import { cae, damagedBase, record } from './damaged-database.fixtures';
import { cutFile, expectLocalDataError, fingerprint, openStore, recoveryOf } from './local-data.fixtures';

/**
 * Fallas que no se arman con archivos (ARQ-12 PR 4b): en Windows una base abierta por otro proceso no se puede
 * renombrar (EBUSY o EPERM), y un disco lleno. Lo de Windows con un proceso real está en data.e2e.ts (solo corre ahí);
 * acá el rename falla a propósito, en los tres sistemas.
 */
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();

  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

vi.mock('../sqlite-driver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sqlite-driver')>();

  return { ...actual, loadSqliteDriver: vi.fn(actual.loadSqliteDriver) };
});

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
const actualDriver = await vi.importActual<typeof import('../sqlite-driver')>('../sqlite-driver');

afterEach(() => {
  vi.mocked(fs.renameSync).mockImplementation(actualFs.renameSync);
  vi.mocked(loadSqliteDriver).mockImplementation(actualDriver.loadSqliteDriver);
});

const OFF = { enabled: false } as const;
const NEXT = record(50);
const setAsideNames = (file: string) => readdirSync(dirname(file)).filter((name) => name.includes('danada'));

describe('en Windows, una dañada abierta por otro (ARQ-12 PR 4b)', () => {
  it.each(['EBUSY', 'EPERM'])(
    'si no se puede mover (%s), ese save da damaged sin tocar y el siguiente la aparta',
    async (code) => {
      const { dataDirectory, file } = await damagedBase((path) => truncateSync(path, 100));
      const before = fingerprint(file);

      // Mientras el otro la tiene abierta, mover la base falla; lo demás (temporales, copias) se mueve.
      vi.mocked(fs.renameSync).mockImplementation((from, to) => {
        if (basename(String(from)) === 'comprobantes.db') {
          throw Object.assign(new Error(`${code}: resource busy or locked, rename`), { code });
        }

        actualFs.renameSync(from, to);
      });

      await expectLocalDataError(openStore(dataDirectory, { backups: OFF }).save(NEXT), 'damaged');
      expect(fs.renameSync).toHaveBeenCalled();
      expect(fingerprint(file)).toEqual(before);
      expect(setAsideNames(file)).toEqual([]);

      // El otro la cerró.
      vi.mocked(fs.renameSync).mockImplementation(actualFs.renameSync);

      const outcome = await openStore(dataDirectory, { backups: OFF }).save(NEXT);

      expect(recoveryOf(outcome)?.setAside).toMatch(/danada/);
      expect(setAsideNames(file)).toHaveLength(1);
    },
  );

  // Un -journal suelto al lado de la base nueva la rompería: si no se puede mover con la dañada, la dañada vuelve.
  it('si el -journal no se puede mover, la dañada vuelve a su lugar y da damaged', async () => {
    const { dataDirectory, file } = await damagedBase((path) => truncateSync(path, 100));
    const journal = `${file}-journal`;

    writeFileSync(journal, Buffer.from('un journal ajeno '.repeat(64)));

    const before = { base: fingerprint(file).hash, journal: fingerprint(journal).hash };

    vi.mocked(fs.renameSync).mockImplementation((from, to) => {
      if (String(from).endsWith('-journal')) {
        throw Object.assign(new Error('EBUSY: resource busy or locked, rename'), { code: 'EBUSY' });
      }

      actualFs.renameSync(from, to);
    });

    await expectLocalDataError(openStore(dataDirectory, { backups: OFF }).save(NEXT), 'damaged');
    expect({ base: fingerprint(file).hash, journal: fingerprint(journal).hash }).toEqual(before);
    expect(setAsideNames(file)).toEqual([]);
  });
});

/** Una conexión que, al guardar un comprobante, falla como SQLite sin lugar en el disco (SQLITE_FULL, 13). */
function diskFullConnection(connection: SqliteConnection): SqliteConnection {
  return {
    all: (sql, parameters) => connection.all(sql, parameters),
    close: () => connection.close(),
    exec: (sql) => connection.exec(sql),
    get: (sql, parameters) => connection.get(sql, parameters),
    run(sql, parameters) {
      if (sql.trimStart().startsWith('INSERT INTO comprobantes')) {
        throw Object.assign(new Error('database or disk is full'), { code: 'ERR_SQLITE_ERROR', errcode: 13 });
      }

      return connection.run(sql, parameters);
    },
  };
}

describe('un disco lleno no es una base dañada (ARQ-12 PR 4b)', () => {
  it('save da disk-full, no aparta nada y la base queda como estaba', async () => {
    const { dataDirectory, file } = await damagedBase(() => undefined);

    vi.mocked(loadSqliteDriver).mockImplementation(async () => {
      const driver = await actualDriver.loadSqliteDriver();

      return { open: (path, options) => diskFullConnection(driver.open(path, options)) };
    });

    await expectLocalDataError(openStore(dataDirectory, { backups: OFF }).save(NEXT), 'disk-full');
    vi.mocked(loadSqliteDriver).mockImplementation(actualDriver.loadSqliteDriver);

    expect(setAsideNames(file)).toEqual([]);
    await expect(openStore(dataDirectory).findByCae(cae(1))).resolves.toMatchObject({ numero: 1 });
    await expect(openStore(dataDirectory).findByCae(NEXT.cae)).resolves.toBeUndefined();
  });
});

describe('una base que otro proceso movió entre mirarla y abrirla (ARQ-12 PR 4b)', () => {
  // Visto en el CI de #318: uno aparta la dañada justo cuando el otro la abre. SQLite no crea una vacía (mustExist) y
  // se vuelve a mirar: vale la que puso el otro.
  it.each([
    ['save', (dataDirectory: string) => openStore(dataDirectory, { backups: OFF }).save(NEXT), { kind: 'saved' }],
    ['findByCae', (dataDirectory: string) => openStore(dataDirectory).findByCae(cae(1)), { numero: 1 }],
  ] as const)('%s la vuelve a mirar y usa la que quedó', async (_name, operation, expected) => {
    const { dataDirectory, file } = await damagedBase(() => undefined);
    let moved = false;

    vi.mocked(loadSqliteDriver).mockImplementation(async () => {
      const driver = await actualDriver.loadSqliteDriver();

      return {
        open(path, options) {
          if (moved || path !== file) {
            return driver.open(path, options);
          }

          moved = true;
          actualFs.renameSync(file, `${file}.otro`);

          try {
            return driver.open(path, options);
          } finally {
            // El otro pone la suya: otro archivo en la misma ruta.
            actualFs.copyFileSync(`${file}.otro`, file);
          }
        },
      };
    });

    await expect(operation(dataDirectory)).resolves.toMatchObject(expected);
    expect(moved).toBe(true);
  });
});

/** Sobre el archivo `ino`, la cabecera como la leyó SQLite en una base cortada (CI de #318, Linux con Node 22.22.1). */
function headerlessConnection(connection: SqliteConnection, path: string, ino: number): SqliteConnection {
  const blind = actualFs.statSync(path).ino === ino;

  return {
    ...connection,
    get(sql, parameters) {
      if (blind && sql === 'PRAGMA application_id') {
        return { application_id: 0 };
      }

      return blind && sql === 'PRAGMA user_version' ? { user_version: 0 } : connection.get(sql, parameters);
    },
  };
}

describe('una base cortada que SQLite lee sin cabecera (ARQ-12 PR 4b)', () => {
  // La cabecera del archivo dice que es de ARCLI: es una base dañada, no la de otro programa.
  it('leer da damaged y save la aparta, no mismatch', async () => {
    const { dataDirectory, file } = await damagedBase((path) => cutFile(path, (size) => Math.floor(size / 2)));
    const { ino } = actualFs.statSync(file);

    vi.mocked(loadSqliteDriver).mockImplementation(async () => {
      const driver = await actualDriver.loadSqliteDriver();

      return { open: (path, options) => headerlessConnection(driver.open(path, options), path, ino) };
    });

    await expectLocalDataError(openStore(dataDirectory).findByCae(cae(1)), 'damaged');

    const outcome = await openStore(dataDirectory, { backups: OFF }).save(NEXT);

    expect(recoveryOf(outcome)?.setAside).toMatch(/danada/);
    expect(setAsideNames(file)).toHaveLength(1);
  });
});
