import { chmodSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  APPLICATION_ID,
  companions,
  CUIT,
  expectLocalDataError,
  fingerprint,
  inspect,
  openStore,
  permissions,
  scalar,
  SCHEMA_V1,
  temporaryDataDirectory,
  voucherRecord,
  vouchersFile,
  withPermissions,
} from './local-data.fixtures';

describe('SqliteVoucherRecordStore: el primer save crea la base (ARQ-12)', () => {
  it('crea datos/<CUIT>/<entorno>/comprobantes.db en v1, sana y sin acompañantes al terminar', async () => {
    const dataDirectory = temporaryDataDirectory();

    await openStore(dataDirectory).save(voucherRecord());

    const file = vouchersFile(dataDirectory);

    expect(readdirSync(dirname(file))).toEqual(['comprobantes.db']);
    expect(companions(file)).toEqual([]);
    inspect(file, (database) => {
      expect(scalar(database, 'PRAGMA user_version')).toBe(SCHEMA_V1);
      expect(scalar(database, 'PRAGMA application_id')).toBe(APPLICATION_ID);
      expect(scalar(database, 'PRAGMA quick_check')).toBe('ok');
      expect(scalar(database, 'PRAGMA journal_mode')).toBe('delete');
    });
  });

  it('produccion y testing son bases distintas del mismo CUIT', async () => {
    const dataDirectory = temporaryDataDirectory();

    await openStore(dataDirectory).save(voucherRecord());
    await openStore(dataDirectory, { environment: 'produccion' }).save(voucherRecord({ cae: '76999999999999' }));

    await expect(openStore(dataDirectory, { environment: 'produccion' }).findByCae('76123456789012')).resolves.toBe(
      undefined,
    );
    expect(existsSync(vouchersFile(dataDirectory, CUIT, 'produccion'))).toBe(true);
  });
});

// Los permisos POSIX no aplican en Windows (ACL): ahí la carpeta del usuario ya es solo suya (TEST-21).
describe.skipIf(!withPermissions)('SqliteVoucherRecordStore: permisos (ARQ-12)', () => {
  let previousUmask: number;

  beforeEach(() => {
    // Una umask común (0644 para archivos nuevos): lo que restringe tiene que ser el código, no el entorno.
    previousUmask = process.umask(0o022);
  });

  afterEach(() => {
    process.umask(previousUmask);
  });

  it('carpetas 0700 y base 0600 con umask 022', async () => {
    const dataDirectory = temporaryDataDirectory();

    await openStore(dataDirectory).save(voucherRecord());

    const file = vouchersFile(dataDirectory);

    expect(permissions(file)).toBe(0o600);
    expect(permissions(dirname(file))).toBe(0o700);
    expect(permissions(dirname(dirname(file)))).toBe(0o700);
    expect(permissions(join(dataDirectory, 'datos'))).toBe(0o700);
  });

  it('carpetas que ya estaban en 0755 quedan en 0700', async () => {
    const dataDirectory = temporaryDataDirectory();
    const folder = join(dataDirectory, 'datos', CUIT, 'testing');

    mkdirSync(folder, { mode: 0o755, recursive: true });
    chmodSync(join(dataDirectory, 'datos'), 0o755);
    chmodSync(join(dataDirectory, 'datos', CUIT), 0o755);
    chmodSync(folder, 0o755);

    await openStore(dataDirectory).save(voucherRecord());

    expect(permissions(folder)).toBe(0o700);
    expect(permissions(dirname(folder))).toBe(0o700);
    expect(permissions(join(dataDirectory, 'datos'))).toBe(0o700);
    expect(permissions(vouchersFile(dataDirectory))).toBe(0o600);
  });

  // El -journal toma los permisos de la base: si la base nació 0644, el journal también lo sería.
  it('el -journal de una escritura en curso sale 0600', async () => {
    const dataDirectory = temporaryDataDirectory();
    const file = vouchersFile(dataDirectory);

    await openStore(dataDirectory).save(voucherRecord());

    inspect(file, (database) => {
      database.exec('BEGIN IMMEDIATE');

      try {
        database.exec(
          "INSERT INTO eventos (tipo, ocurrido_el, version_arcli) VALUES ('prueba', '2026-11-26T15:00:00.000Z', 'x')",
        );

        expect(existsSync(`${file}-journal`)).toBe(true);
        expect(permissions(`${file}-journal`)).toBe(0o600);
      } finally {
        database.exec('ROLLBACK');
      }
    });
  });

  // DELETE: con la carpeta de solo lectura se puede leer pero no crear el -journal (SQLITE_READONLY_DIRECTORY, 1544).
  it('carpeta de solo lectura: save da read-only sin tocar nada, y se sigue leyendo', async () => {
    const dataDirectory = temporaryDataDirectory();
    const file = vouchersFile(dataDirectory);
    const store = openStore(dataDirectory);

    await store.save(voucherRecord());

    const before = fingerprint(file);

    chmodSync(dirname(file), 0o500);

    try {
      await expectLocalDataError(store.save(voucherRecord({ cae: '76999999999999', numero: 2 })), 'read-only');
      await expect(store.findByCae('76123456789012')).resolves.toMatchObject({ numero: 1 });
      expect(fingerprint(file)).toEqual(before);
      expect(readdirSync(dirname(file))).toEqual(['comprobantes.db']);
    } finally {
      chmodSync(dirname(file), 0o700);
    }
  });
});

describe('SqliteVoucherRecordStore: rutas raras (ARQ-12)', () => {
  // La carpeta de la config puede tener cualquier nombre: el de quien usa el CLI, uno sincronizado, uno con símbolos que
  // una URL o una shell interpretan. ñ en NFD: macOS la guarda así y no es la misma cadena que en NFC.
  it.each([
    'con espacios',
    'acentos áéíóú',
    'ñ NFD ñ',
    'emoji 🧾',
    "apóstrofo d'Ana",
    'numeral #1',
    'por ciento %20',
    'shell ;&()',
  ])('guarda y lee en una carpeta con %s', async (name) => {
    const dataDirectory = join(temporaryDataDirectory(), name);
    const store = openStore(dataDirectory);

    await expect(store.save(voucherRecord())).resolves.toEqual({ kind: 'saved' });
    await expect(store.findByCae('76123456789012')).resolves.toMatchObject({ numero: 1 });
    expect(existsSync(vouchersFile(dataDirectory))).toBe(true);
  });

  // SQLite no abre rutas de 260 o más en Windows: se dice antes de intentarlo, sin crear carpetas a medias.
  it.runIf(process.platform === 'win32')('en Windows, una carpeta de 300 caracteres da path-too-long', async () => {
    const parent = temporaryDataDirectory();
    // Cada parte de menos de 255 (el máximo de un nombre en NTFS), hasta llegar a 300 en total.
    const missing = 300 - parent.length - 2;
    const dataDirectory = join(parent, 'x'.repeat(Math.ceil(missing / 2)), 'y'.repeat(Math.floor(missing / 2)));

    expect(dataDirectory).toHaveLength(300);
    await expectLocalDataError(openStore(dataDirectory).save(voucherRecord()), 'path-too-long');
    expect(readdirSync(parent)).toEqual([]);
  });
});
