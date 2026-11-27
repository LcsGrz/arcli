import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ArcliEnvironment } from '../../../modules/config/config.schemas';
import type { SqliteMigration } from '../migrations';

import {
  companions,
  CUIT,
  expectLocalDataError,
  fingerprint,
  inspect,
  openStore,
  OTHER_CUIT,
  scalar,
  SCHEMA_V1,
  temporaryDataDirectory,
  voucherRecord,
  vouchersFile,
} from './local-data.fixtures';

const NUMBER = { numero: 1, puntoVenta: 2, tipo: 11 };
const NEXT = voucherRecord({ cae: '76999999999999', numero: 2 });

/** Una carpeta de datos con una base v1 creada por el adaptador y un comprobante guardado. */
async function savedBase(): Promise<{ dataDirectory: string; file: string }> {
  const dataDirectory = temporaryDataDirectory();

  await openStore(dataDirectory).save(voucherRecord());

  return { dataDirectory, file: vouchersFile(dataDirectory) };
}

/** Ninguna operación toca la base: mismo contenido y fecha, sin -journal ni copia al lado. */
async function expectUntouched(file: string, attempt: () => Promise<void>): Promise<void> {
  const before = fingerprint(file);

  await attempt();

  expect(fingerprint(file)).toEqual(before);
  expect(companions(file)).toEqual([]);
  expect(readdirSync(dirname(file))).toEqual(['comprobantes.db']);
}

const addColumn = (version: number, column = 'prueba'): SqliteMigration => ({
  version,
  up: (exec) => exec(`ALTER TABLE comprobantes ADD COLUMN ${column} TEXT`),
});

const columns = (file: string) =>
  inspect(file, (database) =>
    database
      .prepare("SELECT name FROM pragma_table_info('comprobantes')")
      .all()
      .map(({ name }) => name),
  );

describe('versión del esquema: mayor desconocida (ARQ-12)', () => {
  // La escribió un ARCLI con otro esquema mayor: no se lee ni se escribe, ni con pragmas.
  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('2000: save, findByCae y findByNumber dan newer-version y el archivo queda igual', async () => {
    const { dataDirectory, file } = await savedBase();

    inspect(file, (database) => database.exec('PRAGMA user_version = 2000'));

    const store = openStore(dataDirectory);

    await expectUntouched(file, async () => {
      await expectLocalDataError(store.save(NEXT), 'newer-version');
      await expectLocalDataError(store.findByCae('76123456789012'), 'newer-version');
      await expectLocalDataError(store.findByNumber(NUMBER), 'newer-version');
    });
    expect(inspect(file, (database) => scalar(database, 'PRAGMA user_version'))).toBe(2000);
  });
});

describe('versión del esquema: menor desconocida (ARQ-12)', () => {
  // Una menor solo suma (columna nullable, tabla, índice): el ARCLI que no la conoce lee y escribe igual, sin bajarla.
  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('1001 con una columna y una tabla nuevas: lee, guarda y la deja en 1001', async () => {
    const { dataDirectory, file } = await savedBase();

    inspect(file, (database) =>
      database.exec(
        'BEGIN IMMEDIATE; ALTER TABLE comprobantes ADD COLUMN futura TEXT; CREATE TABLE futura (id INTEGER PRIMARY KEY) STRICT; PRAGMA user_version = 1001; COMMIT',
      ),
    );

    const store = openStore(dataDirectory);

    await expect(store.findByCae('76123456789012')).resolves.toMatchObject({ numero: 1 });
    await expect(store.save(NEXT)).resolves.toEqual({ kind: 'saved' });
    await expect(store.findByNumber({ ...NUMBER, numero: 2 })).resolves.toMatchObject({ cae: NEXT.cae });
    expect(inspect(file, (database) => scalar(database, 'PRAGMA user_version'))).toBe(1001);
    expect(columns(file)).toContain('futura');
  });
});

describe('migraciones (ARQ-12, con una menor de prueba)', () => {
  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('una base v1 con datos pasa a 1001 al abrirla, con los datos', async () => {
    const { dataDirectory, file } = await savedBase();
    const store = openStore(dataDirectory, { extraMigrations: [addColumn(1001)] });

    await expect(store.save(NEXT)).resolves.toEqual({ kind: 'saved' });
    await expect(store.findByCae('76123456789012')).resolves.toMatchObject({ numero: 1 });
    expect(inspect(file, (database) => scalar(database, 'PRAGMA user_version'))).toBe(1001);
    expect(columns(file)).toContain('prueba');
  });

  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('una base nueva sale directo en la última versión', async () => {
    const dataDirectory = temporaryDataDirectory();

    await openStore(dataDirectory, { extraMigrations: [addColumn(1001)] }).save(voucherRecord());

    expect(inspect(vouchersFile(dataDirectory), (database) => scalar(database, 'PRAGMA user_version'))).toBe(1001);
  });

  // La migración va entera en una transacción: si falla a la mitad, no queda la columna con la versión vieja.
  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('si un paso falla, queda en v1 con sus datos y sin la mitad del cambio', async () => {
    const { dataDirectory, file } = await savedBase();
    const broken: SqliteMigration = {
      version: 1001,
      up(exec) {
        exec('ALTER TABLE comprobantes ADD COLUMN prueba TEXT');
        exec('ESTO NO ES SQL');
      },
    };

    await expect(openStore(dataDirectory, { extraMigrations: [broken] }).save(NEXT)).rejects.toThrow();

    expect(inspect(file, (database) => scalar(database, 'PRAGMA user_version'))).toBe(SCHEMA_V1);
    expect(columns(file)).not.toContain('prueba');
    await expect(openStore(dataDirectory).findByCae('76123456789012')).resolves.toMatchObject({ numero: 1 });
    await expect(openStore(dataDirectory).findByCae(NEXT.cae)).resolves.toBeUndefined();
  });
});

describe('base de otro CUIT, entorno o programa (ARQ-12)', () => {
  /** Copia la base creada para CUIT/testing a la carpeta de otro y la abre ahí. */
  async function movedTo(cuit: string, environment: ArcliEnvironment) {
    const { dataDirectory, file } = await savedBase();
    const target = vouchersFile(dataDirectory, cuit, environment);

    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(file, target);

    return { store: openStore(dataDirectory, { cuit, environment }), target };
  }

  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails.each([
    [OTHER_CUIT, 'testing'],
    [CUIT, 'produccion'],
  ] as const)('en la carpeta de %s/%s da mismatch y no se toca', async (cuit, environment) => {
    const { store, target } = await movedTo(cuit, environment);

    await expectUntouched(target, async () => {
      await expectLocalDataError(store.save(NEXT), 'mismatch');
      await expectLocalDataError(store.findByCae('76123456789012'), 'mismatch');
    });
  });

  // Tests primero (ARQ-12 PR 4a): pasa a it() al implementarlo.
  it.fails('una base de SQLite de otro programa (otro application_id) da mismatch y no se toca', async () => {
    const { dataDirectory, file } = await savedBase();

    inspect(file, (database) => database.exec('PRAGMA application_id = 12345'));

    await expectUntouched(file, () => expectLocalDataError(openStore(dataDirectory).save(NEXT), 'mismatch'));
  });
});
