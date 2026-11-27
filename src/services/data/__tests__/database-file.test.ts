import * as fs from 'node:fs';
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { LocalDataError } from '../../../modules/local-data/local-data-error';
import { toLocalDataError } from '../database-file';

import {
  CUIT,
  expectLocalDataError,
  fingerprint,
  inspect,
  openStore,
  scalar,
  SCHEMA_V1,
  temporaryDataDirectory,
  voucherRecord,
  vouchersFile,
  withPermissions,
} from './local-data.fixtures';

// linkSync se puede hacer fallar en un test, para el sistema de archivos sin hard links (FAT, exFAT).
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();

  return { ...actual, linkSync: vi.fn(actual.linkSync) };
});

/** Un archivo cualquiera donde va la base, en una carpeta de datos nueva. */
function withFileInPlace(content: string | Buffer): { dataDirectory: string; file: string } {
  const dataDirectory = temporaryDataDirectory();
  const file = vouchersFile(dataDirectory);

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);

  return { dataDirectory, file };
}

describe('abrir una base que no es de SQLite (ARQ-12): no se toca', () => {
  it.each([
    ['vacía', ''],
    ['de un byte', 'x'],
    ['un JSON', JSON.stringify({ relleno: 'x'.repeat(600) })],
    ['con la cabecera rota', Buffer.concat([Buffer.from('SQLite format 2\0'), Buffer.alloc(4096)])],
  ])('%s: save y findByCae dan damaged', async (_name, content) => {
    const { dataDirectory, file } = withFileInPlace(content);
    const before = fingerprint(file);
    const store = openStore(dataDirectory);

    await expectLocalDataError(store.save(voucherRecord()), 'damaged');
    await expectLocalDataError(store.findByCae('76123456789012'), 'damaged');
    expect(fingerprint(file)).toEqual(before);
    expect(readdirSync(dirname(file))).toEqual(['comprobantes.db']);
  });

  it('una carpeta en lugar del archivo da unavailable, no damaged', async () => {
    const dataDirectory = temporaryDataDirectory();

    mkdirSync(vouchersFile(dataDirectory), { recursive: true });

    await expectLocalDataError(openStore(dataDirectory).save(voucherRecord()), 'unavailable');
  });

  it('una base de SQLite vacía (sin application_id ni versión) da mismatch y no se toca', async () => {
    const { dataDirectory, file } = withFileInPlace('');

    inspect(file, (database) => database.exec('CREATE TABLE otra (a INTEGER) STRICT'));

    const before = fingerprint(file);

    await expectLocalDataError(openStore(dataDirectory).save(voucherRecord()), 'mismatch');
    expect(fingerprint(file)).toEqual(before);
  });

  it('una base de ARCLI sin metadatos da mismatch', async () => {
    const dataDirectory = temporaryDataDirectory();
    const store = openStore(dataDirectory);

    await store.save(voucherRecord());
    inspect(vouchersFile(dataDirectory), (database) => database.exec('ALTER TABLE metadatos RENAME TO otra'));

    await expectLocalDataError(store.findByCae('76123456789012'), 'mismatch');
  });
});

describe('crear la base (ARQ-12)', () => {
  // FAT y exFAT no tienen hard links: se copia sin pisar.
  it('sin hard links, la crea con una copia y sin temporales', async () => {
    vi.mocked(fs.linkSync).mockImplementationOnce(() => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    });

    const dataDirectory = temporaryDataDirectory();

    await expect(openStore(dataDirectory).save(voucherRecord())).resolves.toEqual({ kind: 'saved' });

    const file = vouchersFile(dataDirectory);

    expect(readdirSync(dirname(file))).toEqual(['comprobantes.db']);
    expect(inspect(file, (database) => scalar(database, 'PRAGMA user_version'))).toBe(SCHEMA_V1);
  });

  it('otro error al publicarla sale como vino y no deja temporales', async () => {
    vi.mocked(fs.linkSync).mockImplementationOnce(() => {
      throw Object.assign(new Error('raro'), { code: 'EIO' });
    });

    const dataDirectory = temporaryDataDirectory();

    await expect(openStore(dataDirectory).save(voucherRecord())).rejects.toThrow('raro');
    expect(readdirSync(dirname(vouchersFile(dataDirectory)))).toEqual([]);
  });

  it.runIf(withPermissions)('en una carpeta de datos de solo lectura da read-only sin crear nada', async () => {
    const parent = temporaryDataDirectory();

    chmodSync(parent, 0o500);

    try {
      await expectLocalDataError(openStore(join(parent, 'config')).save(voucherRecord()), 'read-only');
      expect(readdirSync(parent)).toEqual([]);
    } finally {
      chmodSync(parent, 0o700);
    }
  });

  it('el primer save de comprobantes no crea clientes.db', async () => {
    const dataDirectory = temporaryDataDirectory();

    await openStore(dataDirectory).save(voucherRecord());

    expect(existsSync(join(dataDirectory, 'datos', CUIT, 'clientes.db'))).toBe(false);
  });
});

describe('toLocalDataError (ARQ-12)', () => {
  const errno = (code: string) => Object.assign(new Error(code), { code });

  it.each([
    ['EACCES', 'read-only'],
    ['EPERM', 'read-only'],
    ['EROFS', 'read-only'],
    ['ENOSPC', 'disk-full'],
    ['EDQUOT', 'disk-full'],
    ['ENAMETOOLONG', 'path-too-long'],
    ['ENOENT', 'unavailable'],
    ['ENOTDIR', 'unavailable'],
    ['EISDIR', 'unavailable'],
  ])('un error del disco %s es %s', (code, reason) => {
    expect(toLocalDataError(errno(code))).toMatchObject({ name: 'LocalDataError', reason });
  });

  it('una violación de unicidad o un error que no es de la base salen como vinieron', () => {
    const unique = Object.assign(new Error('UNIQUE'), { code: 'ERR_SQLITE_ERROR', errcode: 2067 });
    const bug = new TypeError('bug');

    expect(toLocalDataError(unique)).toBe(unique);
    expect(toLocalDataError(bug)).toBe(bug);
    expect(toLocalDataError(errno('EIO'))).toMatchObject({ code: 'EIO' });
  });

  it('un LocalDataError sale igual y uno de SQLite se traduce con su causa', () => {
    const local = new LocalDataError('locked', 'tomada');
    const busy = Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR', errcode: 5 });

    expect(toLocalDataError(local)).toBe(local);
    expect(toLocalDataError(busy)).toMatchObject({ cause: busy, reason: 'locked' });
  });
});
