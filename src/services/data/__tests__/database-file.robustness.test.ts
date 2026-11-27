import { chmodSync, closeSync, mkdirSync, openSync, readdirSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ensureClientsDatabase } from '../clients-database';
import type { SqliteMigration } from '../migrations';
import { openSqliteConnection } from '../sqlite-driver';

import {
  APPLICATION_ID,
  CUIT,
  expectLocalDataError,
  fingerprint,
  inspect,
  movableClock,
  openStore,
  permissions,
  scalar,
  temporaryDataDirectory,
  VERSION,
  voucherRecord,
  vouchersFile,
  withPermissions,
} from './local-data.fixtures';

/**
 * Lo que protege los datos sin depender de un proceso aparte (ARQ-12): que no queden archivos abiertos, la espera y
 * los intentos cuando la base está tomada, una base dañada por dentro, versiones y rutas. Lo de varios procesos está en
 * data.e2e.ts.
 */
const POSIX = process.platform !== 'win32';

/** Los descriptores abiertos de este proceso. */
const openDescriptors = () => readdirSync('/dev/fd').length;

async function savedBase(): Promise<{ dataDirectory: string; file: string }> {
  const dataDirectory = temporaryDataDirectory();

  await openStore(dataDirectory).save(voucherRecord());

  return { dataDirectory, file: vouchersFile(dataDirectory) };
}

describe('cada operación cierra lo que abre (ARQ-12)', () => {
  // Una conexión o un descriptor sin cerrar en Windows deja la base sin poder moverse ni borrarse (4b la aparta).
  it.runIf(POSIX)('crear, guardar, leer y fallar no dejan archivos abiertos', async () => {
    const { dataDirectory, file } = await savedBase();
    const newer = await savedBase();
    const damaged = temporaryDataDirectory();

    inspect(newer.file, (database) => database.exec('PRAGMA user_version = 2000'));
    mkdirSync(join(damaged, 'datos', CUIT, 'testing'), { recursive: true });
    closeSync(openSync(vouchersFile(damaged), 'w'));

    const before = openDescriptors();

    for (let round = 0; round < 10; round += 1) {
      await openStore(temporaryDataDirectory()).save(voucherRecord());
      await openStore(dataDirectory).save(
        voucherRecord({ cae: String(76_100_000_000_000 + round), numero: 10 + round }),
      );
      await openStore(dataDirectory).save(voucherRecord({ cae: '76123456789012', numero: 99 }));
      await openStore(dataDirectory).findByCae('76123456789012');
      await openStore(dataDirectory).findByNumber({ numero: 1, puntoVenta: 2, tipo: 11 });
      await expect(openStore(dataDirectory).save(voucherRecord({ fecha: undefined } as never))).rejects.toThrow();
      await expectLocalDataError(openStore(newer.dataDirectory).findByCae('76123456789012'), 'newer-version');
      await expectLocalDataError(openStore(damaged).findByCae('76123456789012'), 'damaged');
    }

    expect(openDescriptors()).toBeLessThan(before + 5);
    expect(statSync(file).isFile()).toBe(true);
  });
});

describe('base tomada por otro (ARQ-12)', () => {
  // La espera es por intento y son 3 intentos en total: con 100 ms, unos 300 ms y `locked`, no 15 s ni enseguida.
  it('espera busy_timeout en cada uno de los 3 intentos y da locked', async () => {
    const { dataDirectory, file } = await savedBase();
    const holder = await openSqliteConnection(file, { timeoutMs: 100 });

    holder.exec('BEGIN IMMEDIATE');

    try {
      const started = performance.now();

      await expectLocalDataError(
        openStore(dataDirectory, { busyTimeoutMs: 100 }).save(voucherRecord({ cae: '76999999999999', numero: 2 })),
        'locked',
      );

      const elapsed = performance.now() - started;

      expect(elapsed).toBeGreaterThanOrEqual(280);
      expect(elapsed).toBeLessThan(3000);
    } finally {
      holder.exec('ROLLBACK');
      holder.close();
    }

    await expect(openStore(dataDirectory).findByCae('76999999999999')).resolves.toBeUndefined();
  });
});

describe('una base dañada por dentro (ARQ-12)', () => {
  // La cabecera está bien y una consulta suelta anda, pero quick_check ve la página rota: no se escribe encima.
  it('una página de un índice rota: damaged al leer y al guardar, sin tocar el archivo', async () => {
    const { dataDirectory, file } = await savedBase();

    inspect(file, (database) => {
      const insert = database.prepare(
        "INSERT INTO eventos (tipo, ocurrido_el, version_arcli, datos) VALUES ('relleno', :ahora, 'x', NULL)",
      );

      for (let index = 0; index < 3000; index += 1) {
        insert.run({ ahora: `2026-11-26T15:${String(index % 60).padStart(2, '0')}:00.000Z` });
      }
    });

    const pageSize = Number(inspect(file, (database) => scalar(database, 'PRAGMA page_size')));
    const pages = statSync(file).size / pageSize;
    const descriptor = openSync(file, 'r+');

    writeSync(descriptor, Buffer.alloc(pageSize, 0x41), 0, pageSize, pageSize * (pages - 3));
    closeSync(descriptor);

    const before = fingerprint(file);

    await expectLocalDataError(openStore(dataDirectory).findByCae('76123456789012'), 'damaged');
    await expectLocalDataError(openStore(dataDirectory).save(voucherRecord({ numero: 2 })), 'damaged');
    expect(fingerprint(file)).toEqual(before);
  });
});

describe('versiones (ARQ-12)', () => {
  it('una base con application_id de ARCLI y versión 500 (no es de ARCLI) da mismatch y no se toca', async () => {
    const { dataDirectory, file } = await savedBase();

    inspect(file, (database) => database.exec('PRAGMA user_version = 500'));

    const before = fingerprint(file);

    expect(inspect(file, (database) => scalar(database, 'PRAGMA application_id'))).toBe(APPLICATION_ID);
    await expectLocalDataError(openStore(dataDirectory).save(voucherRecord({ numero: 2 })), 'mismatch');
    expect(fingerprint(file)).toEqual(before);
  });

  // Los pasos se aplican por versión, en el orden que sea que lleguen.
  it('migraciones que llegan desordenadas se aplican en orden y queda la última', async () => {
    const { dataDirectory, file } = await savedBase();
    const step = (version: number, column: string): SqliteMigration => ({
      version,
      up: (exec) => exec(`ALTER TABLE comprobantes ADD COLUMN ${column} TEXT`),
    });

    await openStore(dataDirectory, { extraMigrations: [step(1002, 'segunda'), step(1001, 'primera')] }).findByCae(
      '76123456789012',
    );

    expect(inspect(file, (database) => scalar(database, 'PRAGMA user_version'))).toBe(1002);
    expect(
      inspect(file, (database) =>
        database
          .prepare('SELECT esquema FROM migraciones ORDER BY aplicada_el, esquema')
          .all()
          .map(({ esquema }) => esquema),
      ),
    ).toEqual([1000, 1001, 1002]);
  });
});

describe('rutas fuera de Windows (ARQ-12)', () => {
  // El límite de 250 es de Windows: en macOS y Linux una carpeta de datos larga anda.
  it.runIf(POSIX)('una base de más de 250 caracteres guarda y lee', async () => {
    const parent = temporaryDataDirectory();
    const dataDirectory = join(parent, 'a'.repeat(120), 'b'.repeat(120));

    expect(vouchersFile(dataDirectory).length).toBeGreaterThan(250);
    await expect(openStore(dataDirectory).save(voucherRecord())).resolves.toEqual({ kind: 'saved' });
    await expect(openStore(dataDirectory).findByCae('76123456789012')).resolves.toMatchObject({ numero: 1 });
  });

  it.runIf(POSIX)('un nombre de carpeta más largo que el del sistema da path-too-long', async () => {
    const dataDirectory = join(temporaryDataDirectory(), 'x'.repeat(300));

    await expectLocalDataError(openStore(dataDirectory).findByCae('76123456789012'), 'path-too-long');
    await expectLocalDataError(openStore(dataDirectory).save(voucherRecord()), 'path-too-long');
  });
});

describe('eventos y validación (ARQ-12)', () => {
  it('el evento reemplazo es del CAE nuevo y dice cuál reemplazó', async () => {
    const { dataDirectory, file } = await savedBase();

    await openStore(dataDirectory).save(voucherRecord({ cae: '76999999999999' }));

    expect(
      inspect(file, (database) => ({
        ...database.prepare("SELECT cae, datos FROM eventos WHERE tipo = 'reemplazo'").get(),
      })),
    ).toEqual({ cae: '76999999999999', datos: JSON.stringify({ cae_anterior: '76123456789012' }) });
  });

  it('un registro inválido dice todos los campos en detalles', async () => {
    await expect(
      openStore(temporaryDataDirectory()).save(voucherRecord({ cae: 'x', numero: 0 })),
    ).rejects.toMatchObject({ details: { campos: ['cae', 'numero'] }, message: expect.stringMatching(/cae \(.+\)/) });
  });
});

describe('clientes.db (ARQ-12)', () => {
  it.runIf(withPermissions)('deja datos/ y datos/<CUIT>/ solo para el dueño aunque estuvieran abiertas', async () => {
    const dataDirectory = temporaryDataDirectory();
    const cuitFolder = join(dataDirectory, 'datos', CUIT);

    mkdirSync(cuitFolder, { mode: 0o755, recursive: true });
    chmodSync(join(dataDirectory, 'datos'), 0o755);
    chmodSync(cuitFolder, 0o755);

    await ensureClientsDatabase({ clock: movableClock(), cuit: CUIT, dataDirectory, version: VERSION });

    expect(permissions(join(dataDirectory, 'datos'))).toBe(0o700);
    expect(permissions(cuitFolder)).toBe(0o700);
  });
});
