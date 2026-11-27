import { chmodSync, existsSync, mkdirSync, readdirSync, truncateSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { SaveOutcome } from '../../../modules/vouchers/voucher-record-store';
import { openSqliteConnection } from '../sqlite-driver';

import { cae, DAMAGED_NAME, damagedBase, DAMAGES, record, restoredEvents } from './damaged-database.fixtures';
import {
  APPLICATION_ID,
  backupNames,
  backupsFolder,
  caes,
  DAILY_BACKUP,
  expectLocalDataError,
  fingerprint,
  health,
  makeOld,
  movableClock,
  NOW,
  openStore,
  permissions,
  type Recovery,
  recoveryOf,
  SCHEMA_V1,
  temporaryDataDirectory,
  vouchersFile,
  withPermissions,
} from './local-data.fixtures';

/**
 * Una base dañada (ARQ-12 PR 4b): `save` aparta el original como `comprobantes.danada-<fecha>.db`, byte a byte y con
 * su `-journal`, repone la base desde la última copia sana (o vacía v1), anota `base-repuesta`, guarda y devuelve el
 * dato de la recuperación. Nunca se borra nada. Lo que no es daño no se aparta. Lo de varios procesos y Windows con la
 * base abierta está en data.e2e.ts; un rename que falla, en damaged-database.faults.test.ts.
 */
const OFF = { enabled: false } as const;
const NEXT = record(50);

/** Lo que dio `save`: el resultado o el error, para que la aserción diga cuál fue. */
const settle = (promise: Promise<SaveOutcome>): Promise<unknown> => promise.catch((error: unknown) => error);

/** Los nombres de la carpeta de la base que son una dañada apartada. */
const setAsideNames = (file: string) => readdirSync(dirname(file)).filter((name) => name.includes('danada'));

describe('una base dañada se aparta y se repone (ARQ-12 PR 4b)', () => {
  it.each(DAMAGES)('%s, sin copias: queda apartada igual y save guarda en una v1 vacía', async (_name, damage) => {
    const { dataDirectory, file } = await damagedBase(damage);
    const before = fingerprint(file);

    const outcome = await settle(openStore(dataDirectory, { backups: OFF }).save(NEXT));

    expect(outcome).toMatchObject({ kind: 'saved', recovered: { setAside: expect.stringMatching(/danada/) } });

    const recovered = recoveryOf(outcome as SaveOutcome) as Recovery;

    expect(recovered.restoredFrom).toBeUndefined();
    expect(dirname(recovered.setAside)).toBe(dirname(file));
    expect(basename(recovered.setAside)).toMatch(DAMAGED_NAME);
    expect(fingerprint(recovered.setAside)).toMatchObject({ hash: before.hash, size: before.size });
    expect(health(file)).toEqual({ applicationId: APPLICATION_ID, check: 'ok', version: SCHEMA_V1 });
    expect(caes(file)).toEqual([NEXT.cae]);
    expect(restoredEvents(file)).toEqual([{ cae: null, datos: expect.stringContaining(basename(recovered.setAside)) }]);
    await expect(openStore(dataDirectory).findByCae(NEXT.cae)).resolves.toMatchObject({ numero: NEXT.numero });
  });

  it.runIf(withPermissions)('la base repuesta queda 0600', async () => {
    const { dataDirectory, file } = await damagedBase((path) => truncateSync(path, 100));

    await expect(openStore(dataDirectory, { backups: OFF }).save(NEXT)).resolves.toMatchObject({ kind: 'saved' });
    expect(permissions(file)).toBe(0o600);
  });

  // El -journal es parte de la base: apartar solo el archivo principal perdería lo que el journal tenía.
  it('el -journal se aparta con la dañada, byte a byte', async () => {
    const { dataDirectory, file } = await damagedBase((path) => truncateSync(path, 100));
    const journal = `${file}-journal`;

    writeFileSync(journal, Buffer.from('un journal ajeno '.repeat(64)));
    makeOld(journal);

    const before = fingerprint(journal);
    const outcome = await settle(openStore(dataDirectory, { backups: OFF }).save(NEXT));

    expect(outcome).toMatchObject({ kind: 'saved', recovered: { setAside: expect.stringMatching(/danada/) } });

    const { setAside } = recoveryOf(outcome as SaveOutcome) as Recovery;

    expect(fingerprint(`${setAside}-journal`)).toMatchObject({ hash: before.hash, size: before.size });
    expect(existsSync(journal) ? fingerprint(journal).hash : undefined).not.toBe(before.hash);
  });

  // Dos daños el mismo día no se pisan: cada dañada queda con su nombre.
  it('dos daños el mismo día dejan dos apartadas distintas', async () => {
    const { dataDirectory, file } = await damagedBase((path) => truncateSync(path, 100));
    const first = fingerprint(file);

    await settle(openStore(dataDirectory, { backups: OFF }).save(NEXT));
    writeFileSync(file, JSON.stringify({ relleno: 'y'.repeat(600) }));
    makeOld(file);

    const second = fingerprint(file);

    await settle(openStore(dataDirectory, { backups: OFF }).save(record(51)));

    const names = setAsideNames(file);

    expect(names).toHaveLength(2);
    expect(names.map((name) => fingerprint(join(dirname(file), name)).hash).sort()).toEqual(
      [first.hash, second.hash].sort(),
    );
    expect(caes(file)).toEqual([cae(51)]);
  });

  /** Una base con el 1 en la copia del 1/12, el 2 en la del 2/12 y el 3 después; dañada. */
  async function damagedWithCopies() {
    const dataDirectory = temporaryDataDirectory();
    const file = vouchersFile(dataDirectory);
    const clock = movableClock('2026-12-01T15:00:00.000Z');

    await openStore(dataDirectory, { backups: { enabled: true }, clock }).save(record(1));
    clock.set('2026-12-02T15:00:00.000Z');
    await openStore(dataDirectory, { backups: { enabled: true }, clock }).save(record(2));
    await openStore(dataDirectory, { backups: { enabled: true }, clock }).save(record(3));

    const copies = backupNames(dataDirectory);

    expect(copies).toHaveLength(2);
    expect(copies.every((name) => DAILY_BACKUP.test(name))).toBe(true);

    truncateSync(file, 100);
    makeOld(file);

    const [older = '', newer = ''] = copies.map((name) => join(backupsFolder(dataDirectory), name));

    return { clock, dataDirectory, file, newer, older };
  }

  it('con copias, repone desde la última y la copia queda donde estaba', async () => {
    const { clock, dataDirectory, file, newer, older } = await damagedWithCopies();
    const copiesBefore = [fingerprint(older), fingerprint(newer)];

    const outcome = await settle(openStore(dataDirectory, { backups: OFF, clock }).save(NEXT));

    expect(outcome).toMatchObject({ kind: 'saved', recovered: { restoredFrom: newer } });
    // Lo de la copia del 2/12 más lo nuevo; el 3 (posterior a la copia) quedó en la apartada.
    expect(caes(file)).toEqual([cae(1), cae(2), NEXT.cae]);
    expect([fingerprint(older), fingerprint(newer)]).toEqual(copiesBefore);
    expect(restoredEvents(file)).toEqual([{ cae: null, datos: expect.stringContaining(basename(newer)) }]);
    expect(setAsideNames(file)).toHaveLength(1);
  });

  it('si la última copia también está dañada, repone desde la anterior sin tocar la dañada', async () => {
    const { clock, dataDirectory, file, newer, older } = await damagedWithCopies();

    truncateSync(newer, 100);

    const damagedCopy = fingerprint(newer);
    const outcome = await settle(openStore(dataDirectory, { backups: OFF, clock }).save(NEXT));

    expect(outcome).toMatchObject({ kind: 'saved', recovered: { restoredFrom: older } });
    expect(caes(file)).toEqual([cae(1), NEXT.cae]);
    expect(fingerprint(newer)).toEqual(damagedCopy);
  });

  // Un temporal de más de 10 minutos es de un proceso que murió creando la base: no hay nadie creándola.
  it('con un temporal viejo al lado, la aparta igual', async () => {
    const { dataDirectory, file } = await damagedBase((path) => truncateSync(path, 100));
    const temporary = join(dirname(file), '.nueva-0000abcd');

    writeFileSync(temporary, '');
    makeOld(temporary);

    await expect(openStore(dataDirectory, { backups: OFF }).save(NEXT)).resolves.toMatchObject({
      kind: 'saved',
      recovered: { setAside: expect.stringMatching(/danada/) },
    });
  });
});

describe('lo que no es daño no se aparta (ARQ-12 PR 4b)', () => {
  // Sin hard links, otro proceso puede estar copiando la base en su lugar (docs/architecture.md, "Datos locales"):
  // mientras su temporal está vivo, la base cortada no se aparta.
  it('con un temporal vivo al lado, una base cortada da damaged y no se toca', async () => {
    const { dataDirectory, file } = await damagedBase((path) => truncateSync(path, 100));
    const temporary = join(dirname(file), '.nueva-0000abcd');

    writeFileSync(temporary, '');

    const before = fingerprint(file);

    await expectLocalDataError(openStore(dataDirectory, { backups: OFF }).save(NEXT), 'damaged');
    expect(fingerprint(file)).toEqual(before);
    expect(setAsideNames(file)).toEqual([]);
    expect(existsSync(temporary)).toBe(true);
  });

  it('una carpeta en lugar del archivo da unavailable y queda donde estaba', async () => {
    const dataDirectory = temporaryDataDirectory();
    const file = vouchersFile(dataDirectory);

    mkdirSync(file, { recursive: true });
    writeFileSync(join(file, 'algo.txt'), 'de quien usa la carpeta');
    utimesSync(file, new Date(Date.parse(NOW) - 3_600_000), new Date(Date.parse(NOW) - 3_600_000));

    await expectLocalDataError(openStore(dataDirectory, { backups: OFF }).save(NEXT), 'unavailable');
    expect(readdirSync(dirname(file))).toEqual(['comprobantes.db']);
    expect(readdirSync(file)).toEqual(['algo.txt']);
  });

  it('tomada por otro da locked y no se aparta', async () => {
    const { dataDirectory, file } = await damagedBase(() => undefined);
    const holder = await openSqliteConnection(file, { timeoutMs: 100 });

    holder.exec('BEGIN IMMEDIATE');

    try {
      await expectLocalDataError(openStore(dataDirectory, { backups: OFF, busyTimeoutMs: 100 }).save(NEXT), 'locked');
    } finally {
      holder.exec('ROLLBACK');
      holder.close();
    }

    expect(setAsideNames(file)).toEqual([]);
    expect(caes(file)).toEqual([cae(1), cae(2)]);
  });

  it.runIf(withPermissions)('en una carpeta de solo lectura da read-only y no se toca', async () => {
    const { dataDirectory, file } = await damagedBase(() => undefined);
    const before = fingerprint(file);

    chmodSync(dirname(file), 0o500);

    try {
      await expectLocalDataError(openStore(dataDirectory, { backups: OFF }).save(NEXT), 'read-only');
    } finally {
      chmodSync(dirname(file), 0o700);
    }

    expect(fingerprint(file)).toEqual(before);
    expect(setAsideNames(file)).toEqual([]);
  });
});
