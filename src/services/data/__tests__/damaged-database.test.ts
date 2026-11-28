import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
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

  // Decidido el 27/11: dañada y sin poder apartarla porque la carpeta es de solo lectura, se dice `read-only` (lo que
  // hay que arreglar) y no se toca nada; con el permiso de vuelta, el siguiente save la aparta y la repone.
  it.runIf(withPermissions)('dañada en una carpeta de solo lectura da read-only, sin tocar nada', async () => {
    const { dataDirectory, file } = await damagedBase((path) => truncateSync(path, 100));
    const before = fingerprint(file);

    chmodSync(dirname(file), 0o500);

    try {
      await expectLocalDataError(openStore(dataDirectory, { backups: OFF }).save(NEXT), 'read-only');
    } finally {
      chmodSync(dirname(file), 0o700);
    }

    expect(fingerprint(file)).toEqual(before);
    expect(readdirSync(dirname(file))).toEqual(['comprobantes.db']);

    const outcome = await openStore(dataDirectory, { backups: OFF }).save(NEXT);

    expect(basename(recoveryOf(outcome)?.setAside ?? '')).toMatch(DAMAGED_NAME);
  });
});

/**
 * Sin base pero con copias o una apartada al lado (revisión de #318): se perdió (la apartó otro que murió antes de
 * reponerla, o la borraron). Se repone como una dañada, no se crea vacía como la primera vez.
 */
describe('una base que falta con copias o una apartada al lado (ARQ-12 PR 4b)', () => {
  async function withCopy() {
    const dataDirectory = temporaryDataDirectory();
    const file = vouchersFile(dataDirectory);

    await openStore(dataDirectory, { backups: { enabled: true } }).save(record(1));
    await openStore(dataDirectory, { backups: OFF }).save(record(2));

    return { dataDirectory, file };
  }

  it('la apartó otro que murió antes de reponerla: repone desde la copia y dice cuál era la apartada', async () => {
    const { dataDirectory, file } = await withCopy();
    const aside = join(dirname(file), 'comprobantes.danada-2026-11-26-120000.db');

    renameSync(file, aside);

    const outcome = await openStore(dataDirectory, { backups: OFF }).save(NEXT);

    expect(outcome).toMatchObject({
      kind: 'saved',
      recovered: { restoredFrom: expect.stringMatching(/copias/), setAside: aside },
    });
    expect(caes(file)).toEqual([cae(1), NEXT.cae]);
    expect(restoredEvents(file)).toEqual([{ cae: null, datos: expect.stringContaining(basename(aside)) }]);
    expect(caes(aside)).toEqual([cae(1), cae(2)]);
  });

  it('borrada, con copias: repone desde la última copia, sin apartada', async () => {
    const { dataDirectory, file } = await withCopy();

    rmSync(file);

    const outcome = await openStore(dataDirectory, { backups: OFF }).save(NEXT);

    expect(outcome).toEqual({ kind: 'saved', recovered: { restoredFrom: expect.stringMatching(/copias/) } });
    expect(caes(file)).toEqual([cae(1), NEXT.cae]);
  });

  // Un restaurar que murió después de apartar la actual: la reemplazada era la sana y es más nueva que la copia.
  it('si la apartada más nueva es una reemplazada, repone desde ella y no desde la copia vieja', async () => {
    const { dataDirectory, file } = await withCopy();
    const replaced = join(dirname(file), 'comprobantes.reemplazada-2026-11-26-120000.db');

    renameSync(file, replaced);

    const outcome = await openStore(dataDirectory, { backups: OFF }).save(NEXT);

    expect(outcome).toMatchObject({ kind: 'saved', recovered: { restoredFrom: replaced, setAside: replaced } });
    expect(caes(file)).toEqual([cae(1), cae(2), NEXT.cae]);
    expect(caes(replaced)).toEqual([cae(1), cae(2)]);
  });

  // Tercera pasada de #318: una reemplazada vieja no gana sobre una copia posterior.
  it('si hay una copia más nueva que la reemplazada, repone desde la copia', async () => {
    const dataDirectory = temporaryDataDirectory();
    const file = vouchersFile(dataDirectory);
    const clock = movableClock('2026-11-25T15:00:00.000Z');
    const replaced = join(dirname(file), 'comprobantes.reemplazada-2026-11-25-120000.db');

    await openStore(dataDirectory, { backups: { enabled: true }, clock }).save(record(1));
    copyFileSync(file, replaced);
    clock.set(NOW);
    await openStore(dataDirectory, { backups: { enabled: true }, clock }).save(record(2));
    rmSync(file);

    const outcome = await openStore(dataDirectory, { backups: OFF, clock }).save(NEXT);

    expect(outcome).toMatchObject({
      kind: 'saved',
      recovered: { restoredFrom: expect.stringMatching(/copias.comprobantes-2026-11-26/), setAside: replaced },
    });
    expect(caes(file)).toEqual([cae(1), cae(2), NEXT.cae]);
  });

  // Una reserva vacía que quedó en el nombre del -journal de la apartada no es "su journal": el huérfano va ahí.
  it('el -journal huérfano va con su apartada aunque ahí haya una reserva vacía', async () => {
    const dataDirectory = temporaryDataDirectory();
    const folder = dirname(vouchersFile(dataDirectory));
    const aside = join(folder, 'comprobantes.danada-2026-11-26-120000.db');

    mkdirSync(folder, { recursive: true });
    writeFileSync(aside, 'dañada');
    writeFileSync(`${aside}-journal`, '');
    writeFileSync(join(folder, 'comprobantes.db-journal'), 'journal huérfano');

    await openStore(dataDirectory, { backups: OFF }).save(NEXT);

    expect(readFileSync(`${aside}-journal`, 'utf8')).toBe('journal huérfano');
    expect(existsSync(join(folder, 'comprobantes.db-journal'))).toBe(false);
  });

  // Por fecha y contador numérico (`-10` es después de `-2`); una reserva de 0 bytes de un proceso muerto no cuenta.
  it('la apartada más nueva sale por fecha y contador, sin contar las reservas vacías', async () => {
    const dataDirectory = temporaryDataDirectory();
    const folder = dirname(vouchersFile(dataDirectory));

    mkdirSync(folder, { recursive: true });

    for (const name of ['', '-2', '-10']) {
      writeFileSync(join(folder, `comprobantes.danada-2026-11-26-120000${name}.db`), 'dañada');
    }

    writeFileSync(join(folder, 'comprobantes.danada-2026-11-26-130000.db'), '');

    const outcome = await openStore(dataDirectory, { backups: OFF }).save(NEXT);

    expect(basename(recoveryOf(outcome)?.setAside ?? '')).toBe('comprobantes.danada-2026-11-26-120000-10.db');
  });

  it('la primera vez, sin copias ni apartadas, la crea vacía sin dato de recuperación', async () => {
    await expect(openStore(temporaryDataDirectory(), { backups: OFF }).save(NEXT)).resolves.toEqual({ kind: 'saved' });
  });
});

/**
 * Sin hard links, otro proceso puede estar copiando la base a su lugar y borrar su temporal justo antes de terminar
 * (decidido el 27/11): una base cortada con menos de 10 s se vuelve a mirar unos segundos antes de apartarla.
 */
describe('una base cortada muy reciente (ARQ-12 PR 4b)', () => {
  it('si en la espera queda entera, no se aparta y guarda en ella', { timeout: 20_000 }, async () => {
    const { dataDirectory, file } = await damagedBase(() => undefined);
    const whole = readFileSync(file);

    truncateSync(file, 100);

    const finished = setTimeout(500).then(() => writeFileSync(file, whole));
    const outcome = await openStore(dataDirectory, { backups: OFF }).save(NEXT);

    await finished;
    expect(outcome).toEqual({ kind: 'saved' });
    expect(setAsideNames(file)).toEqual([]);
    expect(caes(file)).toEqual([cae(1), cae(2), NEXT.cae]);
  });

  it('si sigue cortada después de la espera, la aparta', { timeout: 20_000 }, async () => {
    const { dataDirectory, file } = await damagedBase(() => undefined);

    truncateSync(file, 100);
    // Con la fecha en el futuro (un reloj corrido, una carpeta de red) es reciente para siempre: si la espera fuera
    // "hasta que deje de ser reciente" y no la suya de unos segundos, el guardado no terminaría nunca (ARQ-30). Así el
    // tope de abajo no mide la máquina: antes era de 8 s contra 10 s de "reciente", y Windows tardó 10,2 s (CI del
    // 27/11, Node 26, con la suite en paralelo y guardados de hasta 0,7 s).
    const future = new Date(Date.now() + 3_600_000);

    utimesSync(file, future, future);

    const started = Date.now();
    const outcome = await openStore(dataDirectory, { backups: OFF }).save(NEXT);

    expect(Date.now() - started).toBeGreaterThanOrEqual(2500);
    // La espera de 3 s más armar la nueva y moverla, con margen para un runner lento que se frena unos segundos (#315).
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(basename(recoveryOf(outcome)?.setAside ?? '')).toMatch(DAMAGED_NAME);
    expect(caes(file)).toEqual([NEXT.cae]);
  });
});
