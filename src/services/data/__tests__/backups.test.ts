import { copyFileSync, existsSync, mkdirSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ArcliEnvironment } from '../../../modules/config/config.schemas';
import { listVoucherBackups, restoreVoucherBackup } from '../backups';
import type { SqliteMigration } from '../migrations';

import {
  APPLICATION_ID,
  backupNames,
  backupsFolder,
  caes,
  CUIT,
  DAILY_BACKUP,
  expectLocalDataError,
  fingerprint,
  health,
  inspect,
  MIGRATION_BACKUP,
  movableClock,
  NOW,
  openStore,
  OTHER_CUIT,
  permissions,
  scalar,
  SCHEMA_V1,
  temporaryDataDirectory,
  VERSION,
  voucherRecord,
  vouchersFile,
  withPermissions,
} from './local-data.fixtures';

/**
 * Las copias de comprobantes.db (ARQ-12 PR 4b): antes de cada migración (siempre) y la diaria (la primera escritura
 * del día argentino, si `enabled`), con `VACUUM INTO` a un temporal de `copias/` y rename; 7 diarias y 2 de migración.
 * Además, para DATOS-1, listar las copias y restaurar una base desde una. Lo de varios procesos está en data.e2e.ts.
 */

/** Un comprobante ficticio por número: CAE distinto para cada uno. */
const record = (numero: number) => voucherRecord({ cae: String(76_000_000_000_000 + numero), numero });
const cae = (numero: number) => String(76_000_000_000_000 + numero);

const addColumn = (version: number): SqliteMigration => ({
  version,
  up: (exec) => exec(`ALTER TABLE comprobantes ADD COLUMN prueba_${version} TEXT`),
});

const ON = { enabled: true } as const;
const OFF = { enabled: false } as const;

/** Una base v1 con los números dados, sin copias. */
async function baseWith(numeros: readonly number[]): Promise<{ dataDirectory: string; file: string }> {
  const dataDirectory = temporaryDataDirectory();

  for (const numero of numeros) {
    await openStore(dataDirectory, { backups: OFF }).save(record(numero));
  }

  return { dataDirectory, file: vouchersFile(dataDirectory) };
}

const copyOf = (dataDirectory: string, name: string) => join(backupsFolder(dataDirectory), name);

const migrationCopyOf = (file: string, esquema: number) =>
  inspect(file, (database) => scalar(database, `SELECT copia FROM migraciones WHERE esquema = ${esquema}`));

const columns = (file: string) =>
  inspect(file, (database) =>
    database
      .prepare("SELECT name FROM pragma_table_info('comprobantes')")
      .all()
      .map(({ name }) => String(name)),
  );

const backupOptions = (dataDirectory: string, cuit = CUIT, environment: ArcliEnvironment = 'testing') => ({
  clock: movableClock(),
  cuit,
  dataDirectory,
  environment,
  version: VERSION,
});

describe('copia antes de migrar (ARQ-12 PR 4b)', () => {
  // Tests primero (ARQ-12 PR 4b): pasa a it() al implementarlo.
  it.fails('deja en copias/ la base de antes, sana y completa, y la anota en migraciones', async () => {
    const { dataDirectory, file } = await baseWith([1, 2]);

    await expect(
      openStore(dataDirectory, { backups: OFF, extraMigrations: [addColumn(1001)] }).save(record(3)),
    ).resolves.toEqual({ kind: 'saved' });

    const names = backupNames(dataDirectory);

    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(MIGRATION_BACKUP);
    expect(names[0]).toMatch(/^comprobantes-2026-11-26/);

    const copy = copyOf(dataDirectory, names[0] ?? '');

    // La de antes: v1, sin la columna nueva, con los dos que había y sin el que se guardó después.
    expect(health(copy)).toEqual({ applicationId: APPLICATION_ID, check: 'ok', version: SCHEMA_V1 });
    expect(columns(copy)).not.toContain('prueba_1001');
    expect(caes(copy)).toEqual([cae(1), cae(2)]);
    expect(String(migrationCopyOf(file, 1001))).toContain(names[0]);
    expect(health(file).version).toBe(1001);
  });

  // Tests primero (ARQ-12 PR 4b): pasa a it() al implementarlo.
  it.runIf(withPermissions).fails('la copia y su carpeta quedan solo para el dueño', async () => {
    const { dataDirectory } = await baseWith([1]);

    await openStore(dataDirectory, { backups: OFF, extraMigrations: [addColumn(1001)] }).save(record(2));

    const [name = ''] = backupNames(dataDirectory);

    expect(name).toMatch(MIGRATION_BACKUP);
    expect(permissions(backupsFolder(dataDirectory))).toBe(0o700);
    expect(permissions(copyOf(dataDirectory, name))).toBe(0o600);
  });

  // Sin copia no se migra: queda la versión anterior entera y el guardado no entra.
  // Tests primero (ARQ-12 PR 4b): pasa a it() al implementarlo.
  it.fails('si la copia falla, no migra: queda v1 con sus datos y save da unavailable', async () => {
    const { dataDirectory, file } = await baseWith([1, 2]);

    // `copias` es un archivo: no se puede hacer la copia adentro.
    writeFileSync(backupsFolder(dataDirectory), 'no es una carpeta');

    await expectLocalDataError(
      openStore(dataDirectory, { backups: OFF, extraMigrations: [addColumn(1001)] }).save(record(3)),
      'unavailable',
    );

    expect(health(file)).toEqual({ applicationId: APPLICATION_ID, check: 'ok', version: SCHEMA_V1 });
    expect(columns(file)).not.toContain('prueba_1001');
    expect(caes(file)).toEqual([cae(1), cae(2)]);
  });

  it('una base nueva sale en la última versión sin copia de migración', async () => {
    const dataDirectory = temporaryDataDirectory();

    await openStore(dataDirectory, { backups: OFF, extraMigrations: [addColumn(1001)] }).save(record(1));

    expect(backupNames(dataDirectory)).toEqual([]);
  });

  it('sin migración pendiente no hay copia de migración', async () => {
    const { dataDirectory } = await baseWith([1, 2, 3]);

    expect(backupNames(dataDirectory)).toEqual([]);
  });

  // Se guardan las 2 últimas de migración; las diarias no cuentan ni se tocan.
  // Tests primero (ARQ-12 PR 4b): pasa a it() al implementarlo.
  it.fails('tres migraciones dejan las dos últimas copias de migración', async () => {
    const { dataDirectory, file } = await baseWith([1]);
    const steps = [addColumn(1001), addColumn(1002), addColumn(1003)];

    for (const [index] of steps.entries()) {
      await openStore(dataDirectory, { backups: OFF, extraMigrations: steps.slice(0, index + 1) }).save(
        record(10 + index),
      );
    }

    const names = backupNames(dataDirectory);

    expect(names.filter((name) => MIGRATION_BACKUP.test(name))).toHaveLength(2);
    expect(names).toHaveLength(2);
    expect(names).toContain(basename(String(migrationCopyOf(file, 1002))));
    expect(names).toContain(basename(String(migrationCopyOf(file, 1003))));
    expect(names).not.toContain(basename(String(migrationCopyOf(file, 1001))));
  });
});

describe('copia diaria (ARQ-12 PR 4b)', () => {
  // Tests primero (ARQ-12 PR 4b): pasa a it() al implementarlo.
  it.fails('la primera escritura del día deja una copia sana con lo recién guardado', async () => {
    const dataDirectory = temporaryDataDirectory();

    await openStore(dataDirectory, { backups: ON }).save(record(1));

    const names = backupNames(dataDirectory);

    // Solo la copia: el temporal de VACUUM INTO ya se renombró.
    expect(names).toEqual([expect.stringMatching(/^comprobantes-2026-11-26/)]);
    expect(names[0]).toMatch(DAILY_BACKUP);

    const copy = copyOf(dataDirectory, names[0] ?? '');

    expect(health(copy)).toEqual({ applicationId: APPLICATION_ID, check: 'ok', version: SCHEMA_V1 });
    // Después del COMMIT: el comprobante de esa escritura está en la copia.
    expect(caes(copy)).toEqual([cae(1)]);
  });

  // Tests primero (ARQ-12 PR 4b): pasa a it() al implementarlo.
  it.runIf(withPermissions).fails('la copia diaria queda 0600 en una carpeta 0700', async () => {
    const dataDirectory = temporaryDataDirectory();

    await openStore(dataDirectory, { backups: ON }).save(record(1));

    const [name = ''] = backupNames(dataDirectory);

    expect(name).toMatch(DAILY_BACKUP);
    expect(permissions(backupsFolder(dataDirectory))).toBe(0o700);
    expect(permissions(copyOf(dataDirectory, name))).toBe(0o600);
  });

  // El día es el argentino (UTC-3): 02:59 UTC del 27 todavía es el 26 en Argentina; 03:00 UTC ya es el 27.
  // Tests primero (ARQ-12 PR 4b): pasa a it() al implementarlo.
  it.fails('una sola por día argentino: la segunda del día no copia y la del día siguiente sí', async () => {
    const dataDirectory = temporaryDataDirectory();
    const clock = movableClock(NOW);
    const store = openStore(dataDirectory, { backups: ON, clock });

    await store.save(record(1));

    const [first = ''] = backupNames(dataDirectory);

    expect(first).toMatch(DAILY_BACKUP);

    const firstCopy = fingerprint(copyOf(dataDirectory, first));

    clock.set('2026-11-26T20:00:00.000Z');
    await store.save(record(2));
    clock.set('2026-11-27T02:59:59.000Z');
    await store.save(record(3));

    expect(backupNames(dataDirectory)).toEqual([first]);
    expect(fingerprint(copyOf(dataDirectory, first))).toEqual(firstCopy);

    clock.set('2026-11-27T03:00:00.000Z');
    await store.save(record(4));

    const names = backupNames(dataDirectory);

    expect(names).toHaveLength(2);
    expect(names.filter((name) => name.startsWith('comprobantes-2026-11-27'))).toHaveLength(1);
    expect(caes(copyOf(dataDirectory, names.find((name) => name !== first) ?? ''))).toEqual([1, 2, 3, 4].map(cae));
  });

  it('con enabled en false no hay copia diaria ni carpeta de copias', async () => {
    const dataDirectory = temporaryDataDirectory();
    const clock = movableClock(NOW);
    const store = openStore(dataDirectory, { backups: OFF, clock });

    await store.save(record(1));
    clock.set('2026-11-28T15:00:00.000Z');
    await store.save(record(2));

    expect(existsSync(backupsFolder(dataDirectory))).toBe(false);
  });

  // La copia antes de migrar no se apaga: es la única forma de volver si la migración sale mal.
  // Tests primero (ARQ-12 PR 4b): pasa a it() al implementarlo.
  it.fails('con enabled en false igual copia antes de migrar', async () => {
    const { dataDirectory } = await baseWith([1]);

    await openStore(dataDirectory, { backups: OFF, extraMigrations: [addColumn(1001)] }).save(record(2));

    expect(backupNames(dataDirectory)).toEqual([expect.stringMatching(MIGRATION_BACKUP)]);
  });

  // Tests primero (ARQ-12 PR 4b): pasa a it() al implementarlo.
  it.fails('leer en un día nuevo no copia: solo una escritura', async () => {
    const dataDirectory = temporaryDataDirectory();
    const clock = movableClock(NOW);
    const store = openStore(dataDirectory, { backups: ON, clock });

    await store.save(record(1));
    clock.set('2026-11-28T15:00:00.000Z');
    await store.findByCae(cae(1));
    await store.findByNumber({ numero: 1, puntoVenta: 2, tipo: 11 });

    expect(backupNames(dataDirectory)).toEqual([expect.stringMatching(/^comprobantes-2026-11-26/)]);
  });

  // Tests primero (ARQ-12 PR 4b): pasa a it() al implementarlo.
  it.fails('quedan las 7 diarias más nuevas', async () => {
    const dataDirectory = temporaryDataDirectory();
    const clock = movableClock(NOW);
    const store = openStore(dataDirectory, { backups: ON, clock });

    for (let day = 1; day <= 9; day += 1) {
      clock.set(`2026-12-${String(day).padStart(2, '0')}T15:00:00.000Z`);
      await store.save(record(day));
    }

    const names = backupNames(dataDirectory);

    expect(names).toHaveLength(7);
    expect(names.every((name) => DAILY_BACKUP.test(name))).toBe(true);
    expect(names.map((name) => name.slice('comprobantes-'.length, 'comprobantes-'.length + 10))).toEqual(
      [3, 4, 5, 6, 7, 8, 9].map((day) => `2026-12-0${day}`),
    );
  });

  // Tests primero (ARQ-12 PR 4b): pasa a it() al implementarlo.
  it.fails('la retención de las diarias no borra las de migración', async () => {
    const dataDirectory = temporaryDataDirectory();
    const clock = movableClock(NOW);

    await openStore(dataDirectory, { backups: ON, clock }).save(record(100));
    clock.set('2026-11-27T15:00:00.000Z');
    await openStore(dataDirectory, { backups: ON, clock, extraMigrations: [addColumn(1001)] }).save(record(101));

    for (let day = 1; day <= 8; day += 1) {
      clock.set(`2026-12-${String(day).padStart(2, '0')}T15:00:00.000Z`);
      await openStore(dataDirectory, { backups: ON, clock, extraMigrations: [addColumn(1001)] }).save(record(day));
    }

    const names = backupNames(dataDirectory);

    expect(names.filter((name) => DAILY_BACKUP.test(name))).toHaveLength(7);
    expect(names.filter((name) => MIGRATION_BACKUP.test(name))).toHaveLength(1);
  });
});

describe('listar las copias, para DATOS-1 (ARQ-12 PR 4b)', () => {
  it('sin base ni copias, ninguna, y no crea nada', async () => {
    const dataDirectory = temporaryDataDirectory();

    await expect(listVoucherBackups(backupOptions(dataDirectory))).resolves.toEqual([]);
    expect(existsSync(join(dataDirectory, 'datos'))).toBe(false);
  });

  // Tests primero (ARQ-12 PR 4b): pasa a it() al implementarlo.
  it.fails('cada copia con su ruta, fecha, tamaño en bytes y tipo', async () => {
    const dataDirectory = temporaryDataDirectory();
    const clock = movableClock(NOW);

    await openStore(dataDirectory, { backups: ON, clock }).save(record(1));
    clock.set('2026-11-27T15:00:00.000Z');
    await openStore(dataDirectory, { backups: ON, clock, extraMigrations: [addColumn(1001)] }).save(record(2));

    const backups = await listVoucherBackups(backupOptions(dataDirectory));
    const names = backupNames(dataDirectory);

    expect(backups).toHaveLength(names.length);
    expect(backups.map(({ kind }) => kind).sort()).toEqual(['daily', 'daily', 'migration']);

    for (const backup of backups) {
      expect(dirname(backup.path)).toBe(backupsFolder(dataDirectory));
      expect(names).toContain(basename(backup.path));
      expect(backup.sizeBytes).toBe(statSync(backup.path).size);
      expect(backup.createdAt).toMatch(/^2026-11-2[67]T/);
    }

    const daily26 = backups.find(({ path }) => basename(path).startsWith('comprobantes-2026-11-26'));

    expect(daily26).toMatchObject({ createdAt: NOW, kind: 'daily' });
  });
});

describe('restaurar una base desde una copia, para DATOS-1 (ARQ-12 PR 4b)', () => {
  /** Una base con el 1 en la copia del 26 y el 2 guardado después (no está en la copia). */
  async function withDailyCopy() {
    const dataDirectory = temporaryDataDirectory();
    const clock = movableClock(NOW);

    await openStore(dataDirectory, { backups: ON, clock }).save(record(1));
    await openStore(dataDirectory, { backups: ON, clock }).save(record(2));

    const [name = ''] = backupNames(dataDirectory);

    expect(name).toMatch(DAILY_BACKUP);

    return { copy: copyOf(dataDirectory, name), dataDirectory, file: vouchersFile(dataDirectory) };
  }

  // Tests primero (ARQ-12 PR 4b): pasa a it() al implementarlo.
  it.fails('repone la base desde la copia y aparta la actual como reemplazada, sin borrar nada', async () => {
    const { copy, dataDirectory, file } = await withDailyCopy();
    const current = fingerprint(file);
    const copyBefore = fingerprint(copy);

    const restored = await restoreVoucherBackup(backupOptions(dataDirectory), copy);

    expect(restored.restoredFrom).toBe(copy);
    expect(dirname(restored.replaced ?? '')).toBe(dirname(file));
    expect(basename(restored.replaced ?? '')).toMatch(/^comprobantes\.reemplazada-2026-11-26.*\.db$/);
    expect(fingerprint(restored.replaced ?? '').hash).toBe(current.hash);
    expect(fingerprint(copy)).toEqual(copyBefore);
    expect(caes(file)).toEqual([cae(1)]);
    expect(health(file)).toEqual({ applicationId: APPLICATION_ID, check: 'ok', version: SCHEMA_V1 });
    await expect(openStore(dataDirectory, { backups: OFF }).save(record(3))).resolves.toEqual({ kind: 'saved' });
  });

  // Tests primero (ARQ-12 PR 4b): pasa a it() al implementarlo.
  it.fails('una copia dañada da damaged y no toca la base', async () => {
    const { copy, dataDirectory, file } = await withDailyCopy();

    truncateSync(copy, 100);

    const before = fingerprint(file);

    await expectLocalDataError(restoreVoucherBackup(backupOptions(dataDirectory), copy), 'damaged');
    expect(fingerprint(file)).toEqual(before);
    expect(backupNames(dataDirectory)).toHaveLength(1);
  });

  // Una copia de otro CUIT o entorno puesta en esta carpeta no reemplaza la base.
  // Tests primero (ARQ-12 PR 4b): pasa a it() al implementarlo.
  it.fails.each([
    [OTHER_CUIT, 'testing'],
    [CUIT, 'produccion'],
  ] as const)('una copia de %s/%s da mismatch y no toca la base', async (cuit, environment) => {
    const { dataDirectory, file } = await withDailyCopy();
    const other = temporaryDataDirectory();

    await openStore(other, { backups: OFF, cuit, environment }).save(record(9));

    const foreign = copyOf(dataDirectory, 'comprobantes-2026-11-25.db');

    mkdirSync(dirname(foreign), { recursive: true });
    copyFileSync(vouchersFile(other, cuit, environment), foreign);

    const before = fingerprint(file);

    await expectLocalDataError(restoreVoucherBackup(backupOptions(dataDirectory), foreign), 'mismatch');
    expect(fingerprint(file)).toEqual(before);
    expect(caes(file)).toEqual([cae(1), cae(2)]);
  });
});
