import * as fs from 'node:fs';
import { mkdirSync, readdirSync, renameSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { restoreVoucherBackup } from '../backups';
import { loadSqliteDriver, type SqliteConnection, type SqliteDriver } from '../sqlite-driver';

import { cae, damagedBase, record } from './damaged-database.fixtures';
import {
  backupNames,
  backupsFolder,
  caes,
  CUIT,
  expectLocalDataError,
  fingerprint,
  health,
  movableClock,
  openStore,
  SCHEMA_V1,
  temporaryDataDirectory,
  VERSION,
  vouchersFile,
} from './local-data.fixtures';

/**
 * Fallas inyectadas en `node:fs` o en el driver que no se arman con archivos (huecos que dejó Stryker en #318): copias
 * que fallan a la mitad, otro archivo que aparece en el lugar de la base (con y sin hard links), una base que cambia
 * entre mirarla y abrirla, y lo que no es daño mientras se repone.
 */
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();

  return {
    ...actual,
    copyFileSync: vi.fn(actual.copyFileSync),
    linkSync: vi.fn(actual.linkSync),
    openSync: vi.fn(actual.openSync),
    renameSync: vi.fn(actual.renameSync),
  };
});

vi.mock('../sqlite-driver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sqlite-driver')>();

  return { ...actual, loadSqliteDriver: vi.fn(actual.loadSqliteDriver) };
});

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
const actualDriver = await vi.importActual<typeof import('../sqlite-driver')>('../sqlite-driver');

afterEach(() => {
  vi.mocked(fs.copyFileSync).mockImplementation(actualFs.copyFileSync);
  vi.mocked(fs.linkSync).mockImplementation(actualFs.linkSync);
  vi.mocked(fs.openSync).mockImplementation(actualFs.openSync);
  vi.mocked(fs.renameSync).mockImplementation(actualFs.renameSync);
  vi.mocked(loadSqliteDriver).mockImplementation(actualDriver.loadSqliteDriver);
});

const OFF = { enabled: false } as const;
const ON = { enabled: true } as const;
const NEXT = record(50);
const sqliteError = (errcode: number, message: string) =>
  Object.assign(new Error(message), { code: 'ERR_SQLITE_ERROR', errcode });
const isBase = (path: unknown) => basename(String(path)) === 'comprobantes.db';
const isTemporary = (path: unknown) => basename(String(path)).startsWith('.nueva-');

/** El driver real, con `wrap` sobre cada conexión que abre (con la ruta). */
function wrapDriver(wrap: (connection: SqliteConnection, path: string) => SqliteConnection): void {
  vi.mocked(loadSqliteDriver).mockImplementation(async (): Promise<SqliteDriver> => {
    const driver = await actualDriver.loadSqliteDriver();

    return { open: (path, options) => wrap(driver.open(path, options), path) };
  });
}

/** `VACUUM INTO` hacia la carpeta de copias falla como `error`. */
function failCopyingWith(error: Error): void {
  wrapDriver((connection) => ({
    ...connection,
    run(sql, parameters) {
      if (sql.startsWith('VACUUM INTO') && dirname(String(parameters?.destino)).endsWith('copias')) {
        throw error;
      }

      return connection.run(sql, parameters);
    },
  }));
}

/** Un archivo "de otro" aparece en el lugar de la base justo cuando se la pone; `code` es lo que da el hard link. */
function intruderWhenPublishing(code: 'EEXIST' | 'EPERM'): void {
  vi.mocked(fs.linkSync).mockImplementation((from, to) => {
    if (isTemporary(from) && isBase(to)) {
      writeFileSync(to, 'de otro');
      throw Object.assign(new Error(`${code}, link`), { code });
    }

    actualFs.linkSync(from, to);
  });
}

describe('una copia diaria que falla a la mitad no deja nada suelto (ARQ-12 PR 4b)', () => {
  it('si VACUUM INTO falla, no queda el temporal en copias/ y save lo dice', async () => {
    const dataDirectory = temporaryDataDirectory();

    failCopyingWith(sqliteError(13, 'database or disk is full'));

    await expect(openStore(dataDirectory, { backups: ON }).save(NEXT)).resolves.toEqual({
      backupFailed: { reason: 'disk-full' },
      kind: 'saved',
    });
    expect(backupNames(dataDirectory)).toEqual([]);
  });

  // Reservar el nombre de la copia falla por otra cosa que "ya está": sale (no se queda probando nombres).
  it('si reservar el nombre falla sin permiso, save lo dice y no queda nada', async () => {
    const dataDirectory = temporaryDataDirectory();

    vi.mocked(fs.openSync).mockImplementation(((path: fs.PathLike, flags?: fs.OpenMode, mode?: fs.Mode) => {
      if (flags === 'wx' && /^comprobantes-.*\.db$/.test(basename(String(path)))) {
        throw Object.assign(new Error('permission denied, open'), { code: 'EACCES' });
      }

      return actualFs.openSync(path, flags ?? 'r', mode);
    }) as typeof fs.openSync);

    await expect(openStore(dataDirectory, { backups: ON }).save(NEXT)).resolves.toEqual({
      backupFailed: { reason: 'read-only' },
      kind: 'saved',
    });
    expect(backupNames(dataDirectory)).toEqual([]);
  });

  it('si el rename a la reserva falla, la reserva vacía se saca', async () => {
    const dataDirectory = temporaryDataDirectory();

    vi.mocked(fs.renameSync).mockImplementation((from, to) => {
      if (isTemporary(from) && dirname(String(to)).endsWith('copias')) {
        throw Object.assign(new Error('i/o error, rename'), { code: 'EIO' });
      }

      actualFs.renameSync(from, to);
    });

    await expect(openStore(dataDirectory, { backups: ON }).save(NEXT)).resolves.toMatchObject({
      backupFailed: { reason: expect.any(String) },
      kind: 'saved',
    });
    expect(backupNames(dataDirectory)).toEqual([]);
  });
});

describe('otro archivo en el lugar de la base al ponerla no se pisa (ARQ-12 PR 4b)', () => {
  it('al reponer una que falta (con copias), sale el error y no se informa una recuperación', async () => {
    const dataDirectory = temporaryDataDirectory();
    const file = vouchersFile(dataDirectory);

    await openStore(dataDirectory, { backups: ON }).save(record(1));
    rmSync(file);
    intruderWhenPublishing('EEXIST');

    await expectLocalDataError(openStore(dataDirectory, { backups: OFF }).save(NEXT), 'unavailable');
    expect(actualFs.readFileSync(file, 'utf8')).toBe('de otro');
  });

  it('al restaurar donde no hay base, sale el error y lo del otro queda', async () => {
    const source = temporaryDataDirectory();

    await openStore(source, { backups: ON }).save(record(1));

    const [copy = ''] = backupNames(source).map((name) => join(backupsFolder(source), name));
    const dataDirectory = temporaryDataDirectory();
    const file = vouchersFile(dataDirectory);
    const options = {
      clock: movableClock(),
      cuit: CUIT,
      dataDirectory,
      environment: 'testing' as const,
      version: VERSION,
    };

    intruderWhenPublishing('EEXIST');

    await expectLocalDataError(restoreVoucherBackup(options, copy), 'unavailable');
    expect(actualFs.readFileSync(file, 'utf8')).toBe('de otro');
  });

  // Sin hard links se publica con una copia exclusiva: si ya hay otro archivo, tampoco se pisa.
  it('sin hard links, al poner la nueva sobre otro archivo, sale el error y la apartada queda', async () => {
    const { dataDirectory, file } = await damagedBase((path) => truncateSync(path, 100));

    intruderWhenPublishing('EPERM');

    await expectLocalDataError(openStore(dataDirectory, { backups: OFF }).save(NEXT), 'unavailable');
    expect(actualFs.readFileSync(file, 'utf8')).toBe('de otro');
    expect(readdirSync(dirname(file)).filter((name) => name.includes('danada') && name.endsWith('.db'))).toHaveLength(
      1,
    );
  });

  // Sin hard links, devolver un -journal huérfano a su apartada es un rename si el nombre está libre.
  it('sin hard links, el -journal huérfano va igual con su apartada', async () => {
    const dataDirectory = temporaryDataDirectory();
    const folder = dirname(vouchersFile(dataDirectory));
    const aside = join(folder, 'comprobantes.danada-2026-11-26-120000.db');

    mkdirSync(folder, { recursive: true });
    writeFileSync(aside, 'dañada');
    writeFileSync(join(folder, 'comprobantes.db-journal'), 'huérfano');
    vi.mocked(fs.linkSync).mockImplementation((from, to) => {
      if (basename(String(to)).endsWith('-journal')) {
        throw Object.assign(new Error('operation not permitted, link'), { code: 'EPERM' });
      }

      actualFs.linkSync(from, to);
    });

    await openStore(dataDirectory, { backups: OFF }).save(NEXT);

    expect(actualFs.readFileSync(`${aside}-journal`, 'utf8')).toBe('huérfano');
  });
});

describe('mientras se repone, lo que no es daño no se aparta (ARQ-12 PR 4b)', () => {
  // La primera mirada la ve dañada; con el turno, la segunda dice que es de un ARCLI más nuevo: eso no se aparta.
  it('si con el turno resulta ser de un ARCLI más nuevo, da newer-version y no se aparta nada', async () => {
    const { dataDirectory, file } = await damagedBase(() => undefined);
    let opens = 0;

    wrapDriver((connection, path) => {
      if (path !== file) {
        return connection;
      }

      opens += 1;

      return {
        ...connection,
        get(sql, parameters) {
          if (opens === 1 && sql === 'PRAGMA quick_check') {
            return { quick_check: 'página rota' };
          }

          if (opens > 1 && sql === 'PRAGMA user_version') {
            return { user_version: 9000 };
          }

          return connection.get(sql, parameters);
        },
      };
    });

    const before = fingerprint(file);

    await expectLocalDataError(openStore(dataDirectory, { backups: OFF }).save(NEXT), 'newer-version');
    expect(fingerprint(file)).toEqual(before);
    expect(readdirSync(dirname(file)).filter((name) => name.includes('danada'))).toEqual([]);
  });

  // La copia de antes de migrar con la base tomada: se reintenta como tomada y no se migra sin copia.
  it('si la copia de antes de migrar encuentra la base tomada, da locked y queda en v1', async () => {
    const dataDirectory = temporaryDataDirectory();
    const file = vouchersFile(dataDirectory);

    await openStore(dataDirectory, { backups: OFF }).save(record(1));
    failCopyingWith(sqliteError(5, 'database is locked'));

    await expectLocalDataError(
      openStore(dataDirectory, {
        backups: OFF,
        extraMigrations: [
          { up: (exec) => exec('ALTER TABLE comprobantes ADD COLUMN prueba_1001 TEXT'), version: 1001 },
        ],
      }).save(NEXT),
      'locked',
    );
    vi.mocked(loadSqliteDriver).mockImplementation(actualDriver.loadSqliteDriver);
    expect(health(file).version).toBe(SCHEMA_V1);
    expect(caes(file)).toEqual([cae(1)]);
  });
});

describe('una base que cambia entre mirarla y abrirla (ARQ-12 PR 4b)', () => {
  // Si otro la mueve cada vez, se vuelve a mirar unas pocas veces y después sale el error: no se queda dando vueltas.
  it('si desaparece cada vez que se la abre, se rinde después de unos intentos', async () => {
    const { dataDirectory, file } = await damagedBase(() => undefined);
    let opens = 0;

    vi.mocked(loadSqliteDriver).mockImplementation(async (): Promise<SqliteDriver> => {
      const driver = await actualDriver.loadSqliteDriver();

      return {
        open(path, options) {
          if (path === file && actualFs.existsSync(file)) {
            opens += 1;
            renameSync(file, `${file}.otro`);

            try {
              return driver.open(path, options);
            } finally {
              actualFs.copyFileSync(`${file}.otro`, file);
              rmSync(`${file}.otro`);
            }
          }

          return driver.open(path, options);
        },
      };
    });

    await expectLocalDataError(openStore(dataDirectory).findByCae(cae(1)), 'unavailable');
    expect(opens).toBe(3);
  });

  // En una ruta UNC SQLite puede dejar un archivo vacío en ese hueco: es otro archivo, y se vuelve a mirar.
  it('si en el medio queda un archivo vacío en su lugar, se vuelve a mirar y se ve dañado', async () => {
    const { dataDirectory, file } = await damagedBase(() => undefined);
    let replaced = false;

    vi.mocked(loadSqliteDriver).mockImplementation(async (): Promise<SqliteDriver> => {
      const driver = await actualDriver.loadSqliteDriver();

      return {
        open(path, options) {
          if (!replaced && path === file) {
            replaced = true;
            rmSync(file);
            writeFileSync(file, '');

            return driver.open(path, options);
          }

          return driver.open(path, options);
        },
      };
    });

    await expectLocalDataError(openStore(dataDirectory).findByCae(cae(1)), 'damaged');
    expect(replaced).toBe(true);
  });
});
