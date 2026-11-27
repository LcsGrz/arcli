import * as fs from 'node:fs';
import { chmodSync, existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalDataError } from '../../../modules/local-data/local-data-error';
import { toLocalDataError } from '../database-file';

import {
  CUIT,
  expectLocalDataError,
  fingerprint,
  inspect,
  NOW,
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

  return { ...actual, linkSync: vi.fn(actual.linkSync), rmSync: vi.fn(actual.rmSync) };
});

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');

afterEach(() => {
  vi.mocked(fs.rmSync).mockImplementation(actualFs.rmSync);
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

  // El application_id se mira antes que la versión: la base de otro programa con user_version 2000 no es "de un ARCLI
  // más nuevo" (revisión del 27/11).
  it('otro application_id con user_version 2000 da mismatch, no newer-version', async () => {
    const dataDirectory = temporaryDataDirectory();
    const file = vouchersFile(dataDirectory);

    await openStore(dataDirectory).save(voucherRecord());
    inspect(file, (database) => database.exec('PRAGMA application_id = 12345; PRAGMA user_version = 2000'));

    const before = fingerprint(file);

    await expectLocalDataError(openStore(dataDirectory).findByCae('76123456789012'), 'mismatch');
    await expectLocalDataError(openStore(dataDirectory).save(voucherRecord({ numero: 2 })), 'mismatch');
    expect(fingerprint(file)).toEqual(before);
  });

  // Sin permiso para leer el archivo no es una carpeta de solo lectura: es que no se puede abrir.
  it.runIf(withPermissions)('una base sin permiso de lectura da unavailable', async () => {
    const dataDirectory = temporaryDataDirectory();
    const file = vouchersFile(dataDirectory);

    await openStore(dataDirectory).save(voucherRecord());
    chmodSync(file, 0o000);

    try {
      await expectLocalDataError(openStore(dataDirectory).findByCae('76123456789012'), 'unavailable');
    } finally {
      chmodSync(file, 0o600);
    }
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

  // La base ya está en su lugar: que no se pueda borrar el temporal (un antivirus en Windows) no hace fallar el guardado.
  it('si borrar el temporal falla después de publicar, el save igual guarda', async () => {
    vi.mocked(fs.rmSync).mockImplementation((path, options) => {
      if (String(path).includes('.nueva-')) {
        throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
      }

      actualFs.rmSync(path, options);
    });

    const dataDirectory = temporaryDataDirectory();

    await expect(openStore(dataDirectory).save(voucherRecord())).resolves.toEqual({ kind: 'saved' });
    expect(fs.linkSync).toHaveBeenCalled();
    await expect(openStore(dataDirectory).findByCae('76123456789012')).resolves.toMatchObject({ numero: 1 });
  });

  // Un proceso que murió creando la base deja su temporal: el siguiente que crea lo limpia, sin tocar uno vivo.
  it('al crear, borra los temporales viejos de esa base y deja los recientes', async () => {
    const dataDirectory = temporaryDataDirectory();
    const folder = dirname(vouchersFile(dataDirectory));
    const old = join(folder, '.nueva-00000001');
    const recent = join(folder, '.nueva-00000002');
    const hourAgo = new Date(Date.parse(NOW) - 60 * 60 * 1000);
    const minuteAgo = new Date(Date.parse(NOW) - 60 * 1000);

    mkdirSync(folder, { recursive: true });

    for (const [path, time] of [
      [old, hourAgo],
      [`${old}-journal`, hourAgo],
      [recent, minuteAgo],
      [join(folder, 'notas.txt'), hourAgo],
      [join(folder, '.nueva-ver.txt'), hourAgo],
    ] as const) {
      writeFileSync(path, '');
      utimesSync(path, time, time);
    }

    await openStore(dataDirectory).save(voucherRecord());

    // Solo los temporales de la base (`.nueva-` y hex): lo demás de la carpeta no se toca, aunque sea viejo.
    expect(readdirSync(folder).sort()).toEqual(['.nueva-00000002', '.nueva-ver.txt', 'comprobantes.db', 'notas.txt']);
  });

  it('el temporal tiene el mismo largo que la base, para el límite de Windows', async () => {
    const created: string[] = [];

    vi.mocked(fs.rmSync).mockImplementation((path, options) => {
      created.push(String(path));
      actualFs.rmSync(path, options);
    });

    const dataDirectory = temporaryDataDirectory();

    await openStore(dataDirectory).save(voucherRecord());

    const temporary = created.find((path) => /\.nueva-[0-9a-f]+$/.test(path)) ?? '';

    expect(temporary.length).toBe(vouchersFile(dataDirectory).length);
  });

  // Otro proceso la publicó entre que este armó la suya y la quiso poner: vale la del otro (sin hard links, igual).
  it.each([
    ['con hard link', 'EEXIST'],
    ['sin hard links', 'EPERM'],
  ])('%s, si otro la creó a la vez, vale la del otro', async (_name, code) => {
    vi.mocked(fs.linkSync).mockImplementationOnce((temporary, file) => {
      actualFs.copyFileSync(temporary, file);
      throw Object.assign(new Error(code), { code });
    });

    const dataDirectory = temporaryDataDirectory();

    await expect(openStore(dataDirectory).save(voucherRecord())).resolves.toEqual({ kind: 'saved' });
    expect(readdirSync(dirname(vouchersFile(dataDirectory)))).toEqual(['comprobantes.db']);
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
  ])('un error del disco %s es %s, con su causa', (code, reason) => {
    const error = errno(code);

    expect(toLocalDataError(error)).toMatchObject({ cause: error, name: 'LocalDataError', reason });
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
