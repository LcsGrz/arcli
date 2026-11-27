import * as fs from 'node:fs';
import { readdirSync, truncateSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { restoreVoucherBackup } from '../backups';
import { loadSqliteDriver, type SqliteConnection } from '../sqlite-driver';

import { cae, DAMAGED_NAME, damagedBase, record, restoredEvents } from './damaged-database.fixtures';
import {
  backupNames,
  backupsFolder,
  caes,
  expectLocalDataError,
  fingerprint,
  inspect,
  makeOld,
  movableClock,
  openStore,
  recoveryOf,
  temporaryDataDirectory,
  VERSION,
  vouchersFile,
} from './local-data.fixtures';

/**
 * Apartar y reponer cuando algo falla en el medio (revisión de #318): no pisar lo que aparece en el nombre de la
 * apartada, armar la base nueva antes de apartar y, si poner la nueva falla, devolver la apartada con su `-journal`.
 */
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();

  return { ...actual, existsSync: vi.fn(actual.existsSync), linkSync: vi.fn(actual.linkSync) };
});

vi.mock('../sqlite-driver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sqlite-driver')>();

  return { ...actual, loadSqliteDriver: vi.fn(actual.loadSqliteDriver) };
});

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
const actualDriver = await vi.importActual<typeof import('../sqlite-driver')>('../sqlite-driver');

afterEach(() => {
  vi.mocked(fs.existsSync).mockImplementation(actualFs.existsSync);
  vi.mocked(fs.linkSync).mockImplementation(actualFs.linkSync);
  vi.mocked(loadSqliteDriver).mockImplementation(actualDriver.loadSqliteDriver);
});

const OFF = { enabled: false } as const;
const NEXT = record(50);
const namesWith = (file: string, part: string) => readdirSync(dirname(file)).filter((name) => name.includes(part));

/** Poner la base armada en su lugar (el hard link del temporal a comprobantes.db) falla sin lugar en el disco. */
function failPublishing(): void {
  vi.mocked(fs.linkSync).mockImplementation((from, to) => {
    if (basename(String(from)).startsWith('.nueva-') && basename(String(to)) === 'comprobantes.db') {
      throw Object.assign(new Error('no space left on device, link'), { code: 'ENOSPC' });
    }

    actualFs.linkSync(from, to);
  });
}

describe('apartar no pisa nada (revisión de #318)', () => {
  // Otro archivo aparece en el nombre elegido entre que se mira si está libre y se mueve la base.
  it('si en el nombre de la apartada aparece otro archivo, usa el siguiente y ese queda', async () => {
    const { dataDirectory, file } = await damagedBase((path) => truncateSync(path, 100));
    const taken = join(dirname(file), 'comprobantes.danada-2026-11-26-120000.db');

    writeFileSync(taken, 'de otro');
    vi.mocked(fs.existsSync).mockImplementation((path) => (String(path) === taken ? false : actualFs.existsSync(path)));

    const outcome = await openStore(dataDirectory, { backups: OFF }).save(NEXT);

    expect(actualFs.readFileSync(taken, 'utf8')).toBe('de otro');
    expect(basename(recoveryOf(outcome)?.setAside ?? '')).toBe('comprobantes.danada-2026-11-26-120000-2.db');
  });
});

describe('segunda pasada de #318', () => {
  // Otro archivo aparece en el lugar de la base entre apartar y poner la nueva: no se pisa ni se informa una
  // recuperación que no pasó.
  it('si al poner la nueva ya hay otro archivo en su lugar, sale el error y la apartada queda', async () => {
    const { dataDirectory, file } = await damagedBase((path) => truncateSync(path, 100));
    const journal = Buffer.from('un journal ajeno '.repeat(64));

    writeFileSync(`${file}-journal`, journal);
    makeOld(`${file}-journal`);
    vi.mocked(fs.linkSync).mockImplementation((from, to) => {
      if (basename(String(from)).startsWith('.nueva-') && basename(String(to)) === 'comprobantes.db') {
        writeFileSync(to, 'de otro');
        throw Object.assign(new Error('file already exists, link'), { code: 'EEXIST' });
      }

      actualFs.linkSync(from, to);
    });

    await expectLocalDataError(openStore(dataDirectory, { backups: OFF }).save(NEXT), 'unavailable');
    expect(actualFs.readFileSync(file, 'utf8')).toBe('de otro');

    const [aside = ''] = namesWith(file, 'danada').filter((name) => name.endsWith('.db'));

    // El -journal sigue con la apartada: al lado del intruso lo rompería.
    expect(actualFs.readFileSync(join(dirname(file), `${aside}-journal`))).toEqual(journal);
    expect(actualFs.existsSync(`${file}-journal`)).toBe(false);
  });

  // La base se perdió entre que se la miró (estaba) y se la abrió: la decisión con el turno es la misma que reponer.
  it('si la base desaparece entre mirarla y abrirla, con copias, se repone desde la copia', async () => {
    const dataDirectory = temporaryDataDirectory();
    const file = vouchersFile(dataDirectory);
    const aside = join(dirname(file), 'comprobantes.danada-2026-11-26-120000.db');
    let moved = false;

    await openStore(dataDirectory, { backups: { enabled: true } }).save(record(1));

    vi.mocked(loadSqliteDriver).mockImplementation(async () => {
      const driver = await actualDriver.loadSqliteDriver();

      return {
        open(path, options) {
          if (!moved && path === file) {
            moved = true;
            actualFs.renameSync(file, aside);
          }

          return driver.open(path, options);
        },
      };
    });

    const outcome = await openStore(dataDirectory, { backups: OFF }).save(NEXT);

    expect(moved).toBe(true);
    expect(outcome).toMatchObject({
      kind: 'saved',
      recovered: { restoredFrom: expect.stringMatching(/copias/), setAside: aside },
    });
    expect(caes(file)).toEqual([cae(1), NEXT.cae]);
  });
});

describe('si poner la base nueva falla, la apartada vuelve (revisión de #318)', () => {
  it('la dañada vuelve a su lugar con su -journal, byte a byte, y el siguiente save la aparta', async () => {
    const { dataDirectory, file } = await damagedBase((path) => truncateSync(path, 100));
    const journal = `${file}-journal`;

    writeFileSync(journal, Buffer.from('un journal ajeno '.repeat(64)));
    makeOld(journal);

    const before = { base: fingerprint(file).hash, journal: fingerprint(journal).hash };

    failPublishing();
    await expectLocalDataError(openStore(dataDirectory, { backups: OFF }).save(NEXT), 'disk-full');

    expect({ base: fingerprint(file).hash, journal: fingerprint(journal).hash }).toEqual(before);
    expect(namesWith(file, 'danada')).toEqual([]);

    vi.mocked(fs.linkSync).mockImplementation(actualFs.linkSync);

    const outcome = await openStore(dataDirectory, { backups: OFF }).save(NEXT);

    expect(basename(recoveryOf(outcome)?.setAside ?? '')).toMatch(DAMAGED_NAME);
  });

  // Una dañada con su -journal: el mismo deshacer que al apartar (`putBack`) devuelve los dos.
  it('al restaurar, la dañada que estaba vuelve a su lugar con su -journal', async () => {
    const { dataDirectory, file } = await damagedBase((path) => truncateSync(path, 100));
    const journal = `${file}-journal`;
    const copyFolder = temporaryDataDirectory();
    const clock = movableClock();

    await openStore(copyFolder, { backups: { enabled: true }, clock }).save(record(1));

    const [copy = ''] = backupNames(copyFolder).map((name) => join(backupsFolder(copyFolder), name));

    writeFileSync(journal, Buffer.from('un journal ajeno '.repeat(64)));

    const before = { base: fingerprint(file).hash, journal: fingerprint(journal).hash };
    const options = { clock, cuit: '20111111112', dataDirectory, environment: 'testing' as const, version: VERSION };

    failPublishing();
    await expectLocalDataError(restoreVoucherBackup(options, copy), 'disk-full');

    expect({ base: fingerprint(file).hash, journal: fingerprint(journal).hash }).toEqual(before);
    expect(namesWith(file, 'reemplazada')).toEqual([]);
  });

  it('al restaurar, la que estaba vuelve a su lugar', async () => {
    const dataDirectory = temporaryDataDirectory();
    const clock = movableClock();

    await openStore(dataDirectory, { backups: { enabled: true }, clock }).save(record(1));
    await openStore(dataDirectory, { backups: OFF, clock }).save(record(2));

    const file = vouchersFile(dataDirectory);
    const [copy = ''] = backupNames(dataDirectory).map((name) => join(backupsFolder(dataDirectory), name));
    const before = fingerprint(file).hash;
    const options = { clock, cuit: '20111111112', dataDirectory, environment: 'testing' as const, version: VERSION };

    failPublishing();
    await expectLocalDataError(restoreVoucherBackup(options, copy), 'disk-full');

    expect(fingerprint(file).hash).toBe(before);
    expect(namesWith(file, 'reemplazada')).toEqual([]);
    expect(caes(file)).toEqual([cae(1), cae(2)]);
  });
});

/** Una conexión que falla como SQLite sin lugar (SQLITE_FULL) al armar una base nueva en un temporal. */
function fullWhenBuilding(connection: SqliteConnection): SqliteConnection {
  return {
    ...connection,
    run(sql, parameters) {
      if (sql.startsWith('VACUUM INTO') && basename(String(parameters?.destino)).startsWith('.nueva-')) {
        throw Object.assign(new Error('database or disk is full'), { code: 'ERR_SQLITE_ERROR', errcode: 13 });
      }

      return connection.run(sql, parameters);
    },
  };
}

describe('la base nueva se arma antes de apartar (revisión de #318)', () => {
  // Sin lugar para armar la nueva desde la copia, no se aparta nada: no queda una base vacía en lugar de la copia.
  it('si armarla desde la copia falla, la dañada queda como estaba; el siguiente save repone desde la copia', async () => {
    const dataDirectory = temporaryDataDirectory();
    const file = vouchersFile(dataDirectory);

    await openStore(dataDirectory, { backups: { enabled: true } }).save(record(1));
    truncateSync(file, 100);
    makeOld(file);

    const before = fingerprint(file);

    vi.mocked(loadSqliteDriver).mockImplementation(async () => {
      const driver = await actualDriver.loadSqliteDriver();

      return { open: (path, options) => fullWhenBuilding(driver.open(path, options)) };
    });

    await expectLocalDataError(openStore(dataDirectory, { backups: OFF }).save(NEXT), 'disk-full');
    expect(fingerprint(file)).toEqual(before);
    expect(namesWith(file, 'danada')).toEqual([]);
    expect(namesWith(file, '.nueva-')).toEqual([]);

    vi.mocked(loadSqliteDriver).mockImplementation(actualDriver.loadSqliteDriver);

    const outcome = await openStore(dataDirectory, { backups: OFF }).save(NEXT);

    expect(recoveryOf(outcome)?.restoredFrom).toMatch(/copias/);
    expect(caes(file)).toEqual([cae(1), NEXT.cae]);
    expect(restoredEvents(file)).toHaveLength(1);
  });
});

/** Lo que haría otro ARCLI que migra a 1001 justo antes: el paso, su fila en `migraciones` y la versión. */
function migrateAsOther(file: string): void {
  inspect(file, (database) => {
    database.exec('BEGIN IMMEDIATE');
    database.exec('ALTER TABLE comprobantes ADD COLUMN prueba_1001 TEXT');
    database.exec(
      "INSERT INTO migraciones (esquema, aplicada_el, version_arcli, copia) VALUES (1001, '2026-11-26T15:00:00.000Z', 'otro', NULL)",
    );
    database.exec('PRAGMA user_version = 1001');
    database.exec('COMMIT');
  });
}

describe('varios migrando a la vez (revisión de #318)', () => {
  // Otro proceso migra entre que este leyó la versión y hizo su copia: esa copia ya es del esquema nuevo y se descarta.
  it('una copia que salió del esquema nuevo no queda como -antes-de', async () => {
    const dataDirectory = temporaryDataDirectory();
    const file = vouchersFile(dataDirectory);
    let migratedByOther = false;

    await openStore(dataDirectory, { backups: OFF }).save(record(1));

    vi.mocked(loadSqliteDriver).mockImplementation(async () => {
      const driver = await actualDriver.loadSqliteDriver();

      return {
        open(path, options) {
          const connection = driver.open(path, options);

          return {
            ...connection,
            run(sql, parameters) {
              if (!migratedByOther && sql.startsWith('VACUUM INTO')) {
                migratedByOther = true;
                migrateAsOther(file);
              }

              return connection.run(sql, parameters);
            },
          };
        },
      };
    });

    await expect(
      openStore(dataDirectory, {
        backups: OFF,
        extraMigrations: [
          { up: (exec) => exec('ALTER TABLE comprobantes ADD COLUMN prueba_1001 TEXT'), version: 1001 },
        ],
      }).save(record(2)),
    ).resolves.toEqual({ kind: 'saved' });

    expect(migratedByOther).toBe(true);
    expect(backupNames(dataDirectory)).toEqual([]);
  });

  // ARQ-29 (CI de #319, ubuntu con Node 26): otro migra justo después de que este leyó la versión para ver si faltaba
  // migrar. Si la vuelve a leer para saber desde dónde, ya es la última: la copia sale del esquema nuevo, adentro de la
  // transacción la versión coincide y no hay paso que aplicar, así que nadie la descartaba.
  it('otro migra justo después de leer la versión: no queda una copia -antes-de del esquema nuevo', async () => {
    const dataDirectory = temporaryDataDirectory();
    const file = vouchersFile(dataDirectory);
    let migratedByOther = false;

    await openStore(dataDirectory, { backups: OFF }).save(record(1));

    vi.mocked(loadSqliteDriver).mockImplementation(async () => {
      const driver = await actualDriver.loadSqliteDriver();

      return {
        open(path, options) {
          const connection = driver.open(path, options);
          let checked = false;

          return {
            ...connection,
            get(sql, parameters) {
              const row = connection.get(sql, parameters);

              // La primera lectura de la versión después de quick_check es la de `migrate`.
              checked ||= path === file && sql === 'PRAGMA quick_check';

              if (checked && !migratedByOther && sql === 'PRAGMA user_version') {
                migratedByOther = true;
                migrateAsOther(file);
              }

              return row;
            },
          };
        },
      };
    });

    await expect(
      openStore(dataDirectory, {
        backups: OFF,
        extraMigrations: [
          { up: (exec) => exec('ALTER TABLE comprobantes ADD COLUMN prueba_1001 TEXT'), version: 1001 },
        ],
      }).save(record(2)),
    ).resolves.toEqual({ kind: 'saved' });

    expect(migratedByOther).toBe(true);
    expect(backupNames(dataDirectory)).toEqual([]);
    expect(inspect(file, (database) => database.prepare('SELECT esquema, copia FROM migraciones').all())).toEqual([
      expect.objectContaining({ esquema: 1000 }),
      { copia: null, esquema: 1001 },
    ]);
  });

  // Sin hard links (FAT, exFAT) y con otro archivo que aparece en el nombre de la copia: no se pisa (segunda pasada).
  it('la copia no pisa un archivo que aparece en su nombre, tampoco sin hard links', async () => {
    const dataDirectory = temporaryDataDirectory();
    const taken = join(backupsFolder(dataDirectory), 'comprobantes-2026-11-26-120000-antes-de-1001.db');

    await openStore(dataDirectory, { backups: OFF }).save(record(1));
    actualFs.mkdirSync(backupsFolder(dataDirectory), { recursive: true });
    writeFileSync(taken, 'de otro');
    vi.mocked(fs.existsSync).mockImplementation((path) => (String(path) === taken ? false : actualFs.existsSync(path)));
    vi.mocked(fs.linkSync).mockImplementation(() => {
      throw Object.assign(new Error('operation not permitted, link'), { code: 'EPERM' });
    });

    await openStore(dataDirectory, {
      backups: OFF,
      extraMigrations: [{ up: (exec) => exec('ALTER TABLE comprobantes ADD COLUMN prueba_1001 TEXT'), version: 1001 }],
    }).save(record(2));

    expect(actualFs.readFileSync(taken, 'utf8')).toBe('de otro');
    expect(backupNames(dataDirectory)).toContain('comprobantes-2026-11-26-120000-antes-de-1001-2.db');
  });
});
