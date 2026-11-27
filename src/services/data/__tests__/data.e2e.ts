import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { restoreVoucherBackup } from '../backups';

import {
  backupNames,
  backupsFolder,
  cutFile,
  fingerprint,
  inspect,
  makeOld,
  openStore,
  scalar,
  SCHEMA_V1,
  temporaryDataDirectory,
  voucherRecord,
  vouchersFile,
} from './local-data.fixtures';

const storeRecord = (numero: number) => voucherRecord({ cae: String(76_000_000_000_000 + numero), numero });

/**
 * Los datos locales con procesos reales sobre el adaptador compilado (ARQ-12 PR 4a): varios ARCLI a la vez, uno que
 * muere en medio de una escritura, el aviso de Node 22. Corre con `yarn build && yarn test:e2e`, en Linux, macOS y
 * Windows. Lo que lanza está en fixtures/data-child.mjs; cada proceso tiene su carpeta de config temporal.
 */
const DIST = resolve('dist');
const CHILD = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'data-child.mjs');
const HANG_MS = 30_000;

interface Child {
  readonly closed: Promise<unknown>;
  readonly output: { stderr: string; stdout: string };
  readonly process: ChildProcess;
}

const running: Child[] = [];

afterEach(async () => {
  for (const child of running.splice(0)) {
    if (child.process.exitCode === null && child.process.signalCode === null) {
      child.process.kill('SIGKILL');
    }

    await child.closed;
  }
});

function start(args: readonly (number | string)[], barrier?: string): Child {
  const child = spawn(process.execPath, [CHILD, ...args.map(String)], {
    env: {
      ...process.env,
      ARCLI_CONFIG_DIR: temporaryDataDirectory('arcli-e2e-datos-config-'),
      ARCLI_TEST_BARRIER: barrier ?? '',
      ARCLI_TEST_DIST: DIST,
      FORCE_COLOR: '0',
      NO_UPDATE_NOTIFIER: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = { stderr: '', stdout: '' };

  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output.stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output.stderr += chunk));

  const started = { closed: once(child, 'close'), output, process: child };

  running.push(started);

  return started;
}

const lines = (child: Child) => child.output.stdout.split(/\r?\n/).filter(Boolean);
const exited = (child: Child) => child.process.exitCode !== null || child.process.signalCode !== null;

/** Espera a que el proceso diga `line` (o termine: entonces falla con lo que escribió en stderr). */
async function untilSays(child: Child, line: string): Promise<void> {
  for (const deadline = Date.now() + HANG_MS; !lines(child).includes(line); await pause(2)) {
    if (exited(child) || Date.now() > deadline) {
      throw new Error(`El proceso no dijo "${line}": ${child.output.stderr.slice(-800)}`);
    }
  }
}

/** El último renglón del proceso, como JSON, cuando termina. */
async function result(child: Child): Promise<Record<string, unknown>> {
  await child.closed;

  const last = lines(child).at(-1);

  expect(last, `sin salida; stderr: ${child.output.stderr.slice(-800)}`).toBeDefined();

  return JSON.parse(last ?? '{}') as Record<string, unknown>;
}

async function kill(child: Child): Promise<void> {
  child.process.kill('SIGKILL');
  await child.closed;
}

/** Varios procesos que arrancan a la vez: esperan un archivo que se crea cuando todos están listos. */
async function together(argsList: readonly (readonly (number | string)[])[]): Promise<Child[]> {
  const barrier = join(temporaryDataDirectory('arcli-e2e-barrera-'), 'ya');
  const children = argsList.map((args) => start(args, barrier));

  await Promise.all(children.map((child) => untilSays(child, 'listo')));
  writeFileSync(barrier, '');

  return children;
}

/** Una base v1 con `count` comprobantes (números 1 a `count`), creada por el adaptador. */
async function baseWith(count: number): Promise<{ dataDirectory: string; file: string }> {
  const dataDirectory = temporaryDataDirectory('arcli-e2e-datos-');

  expect(await result(start(['guardar', dataDirectory, 1, count]))).toMatchObject({
    errors: [],
    outcomes: { saved: count },
  });

  return { dataDirectory, file: vouchersFile(dataDirectory) };
}

const count = (file: string, where = '1') =>
  Number(inspect(file, (database) => scalar(database, `SELECT count(*) FROM comprobantes WHERE ${where}`)));

const health = (file: string) =>
  inspect(file, (database) => ({
    integrity: scalar(database, 'PRAGMA integrity_check'),
    version: scalar(database, 'PRAGMA user_version'),
  }));

describe('datos locales con procesos reales (ARQ-12 PR 4a)', () => {
  // Con DELETE y carga continua, Windows da "database is locked" aun con 5 s (CI del 25/11): el reintento, con su pausa
  // al azar (26/11), lo cubre.
  it.each([
    [2, 300],
    [8, 100],
  ])('%i procesos × %i guardados sobre la misma base: todos, sin errores y sana', async (processes, each) => {
    const dataDirectory = temporaryDataDirectory('arcli-e2e-datos-');
    const children = await together(
      Array.from({ length: processes }, (_, index) => ['guardar', dataDirectory, 1 + index * each, each]),
    );

    for (const child of children) {
      expect(await result(child)).toMatchObject({ errors: [], outcomes: { saved: each } });
    }

    const file = vouchersFile(dataDirectory);

    expect(count(file)).toBe(processes * each);
    expect(health(file)).toEqual({ integrity: 'ok', version: SCHEMA_V1 });
  });

  // Otro proceso tiene la base más que la espera de SQLite (bajada a 300 ms): el guardado se reintenta y entra.
  it('tomada por otro más que la espera: reintenta y guarda', async () => {
    const { dataDirectory, file } = await baseWith(1);
    const barrier = join(temporaryDataDirectory('arcli-e2e-barrera-'), 'ya');
    const saver = start(['guardar', dataDirectory, 2, 1, 300], barrier);

    await untilSays(saver, 'listo');

    const holder = start(['sostener', file, 500]);

    await untilSays(holder, 'tomado');
    writeFileSync(barrier, '');

    const saved = await result(saver);

    expect(saved).toMatchObject({ errors: [], outcomes: { saved: 1 } });
    // Esperó más que un intento: sin reintento habría salido `locked` a los 300 ms.
    expect(saved.ms).toBeGreaterThanOrEqual(300);
    await holder.closed;
    expect(count(file)).toBe(2);
  });

  // Tras SIGKILL queda un -journal caliente: abrir con readOnly fallaría (SQLITE_READONLY_ROLLBACK). Cinco veces.
  it('SIGKILL en medio de una transacción ×5: misma versión, sin filas a medias, sana, y el siguiente guarda', async () => {
    const { dataDirectory, file } = await baseWith(3);

    for (let round = 0; round < 5; round += 1) {
      const victim = start(['victima', file]);

      await untilSays(victim, 'medio');
      await kill(victim);

      expect(existsSync(`${file}-journal`)).toBe(true);
      expect(await result(start(['guardar', dataDirectory, 10 + round, 1]))).toMatchObject({
        errors: [],
        outcomes: { saved: 1 },
      });
      expect(health(file)).toEqual({ integrity: 'ok', version: SCHEMA_V1 });
      expect(inspect(file, (database) => scalar(database, "SELECT count(*) FROM eventos WHERE tipo = 'victima'"))).toBe(
        0,
      );
      expect(count(file)).toBe(3 + round + 1);
    }
  });

  // Lo que el proceso llegó a decir que guardó está, aunque lo maten enseguida (synchronous=FULL).
  it('un proceso que guarda sin parar y muere no pierde lo que avisó', async () => {
    const { dataDirectory, file } = await baseWith(1);
    const writer = start(['confirmador', dataDirectory, 100]);

    for (const deadline = Date.now() + HANG_MS; lines(writer).length < 20; await pause(2)) {
      if (exited(writer) || Date.now() > deadline) {
        throw new Error(`El proceso no guardó: ${writer.output.stderr.slice(-800)}`);
      }
    }

    await kill(writer);

    const announced = lines(writer).map(Number);
    const missing = announced.filter((numero) => count(file, `numero = ${numero}`) !== 1);

    expect(announced.length).toBeGreaterThanOrEqual(20);
    expect(missing).toEqual([]);
    expect(health(file)).toEqual({ integrity: 'ok', version: SCHEMA_V1 });
  });

  // Cuatro que guardan por primera vez a la vez: uno crea la base y los demás la abren; nadie pisa a nadie.
  it('4 procesos crean la base a la vez: todas las filas, un solo archivo, sin temporales', async () => {
    const dataDirectory = temporaryDataDirectory('arcli-e2e-datos-');
    const children = await together([1, 2, 3, 4].map((index) => ['guardar', dataDirectory, index * 100, 10]));

    for (const child of children) {
      expect(await result(child)).toMatchObject({ errors: [], outcomes: { saved: 10 } });
    }

    const file = vouchersFile(dataDirectory);

    expect(count(file)).toBe(40);
    expect(health(file)).toEqual({ integrity: 'ok', version: SCHEMA_V1 });
    expect(readdirSync(dirname(file)).filter((name) => name !== 'copias')).toEqual(['comprobantes.db']);
    expect(readdirSync(dirname(dirname(file)))).toEqual(['testing']);
  });

  // La migración va en una transacción con la versión adentro: matarla a la mitad deja la v1 entera, y el reintento
  // no encuentra la columna a medias ("duplicate column name").
  it('SIGKILL durante una migración: queda en v1 con sus datos y el reintento migra', async () => {
    const { dataDirectory, file } = await baseWith(3);
    const victim = start(['migrar', dataDirectory, 'si', 50]);

    await untilSays(victim, 'medio');
    await kill(victim);

    expect(health(file)).toEqual({ integrity: 'ok', version: SCHEMA_V1 });
    expect(count(file)).toBe(3);

    const retry = start(['migrar', dataDirectory, 'no', 51]);

    expect(await result(retry)).toEqual({ outcome: { kind: 'saved' } });
    expect(retry.output.stderr).not.toContain('duplicate column');
    expect(health(file)).toEqual({ integrity: 'ok', version: 1001 });
    expect(count(file)).toBe(4);
  });

  it('4 procesos migran a la vez: todos bien y queda en la menor nueva', async () => {
    const { dataDirectory, file } = await baseWith(3);
    const children = await together([1, 2, 3, 4].map((index) => ['migrar', dataDirectory, 'no', 50 + index]));

    for (const child of children) {
      expect(await result(child)).toEqual({ outcome: { kind: 'saved' } });
    }

    expect(health(file)).toEqual({ integrity: 'ok', version: 1001 });
    expect(count(file)).toBe(7);

    // Revisión de #318: cada copia de antes de migrar es de antes (v1) y la anotada en migraciones está.
    const copies = backupNames(dataDirectory).filter((name) => name.includes('-antes-de-1001'));
    const recorded = inspect(file, (database) =>
      scalar(database, 'SELECT copia FROM migraciones WHERE esquema = 1001'),
    );

    expect(copies).toContain(String(recorded));

    for (const name of copies) {
      expect(health(join(backupsFolder(dataDirectory), name)).version).toBe(SCHEMA_V1);
    }
  });

  // Node 22 avisa "SQLite is an experimental feature" al cargarlo: se oculta ese y solo ese. 24 y 26 no avisan.
  it('guardar no escribe nada en stderr, en ningún Node', async () => {
    const child = start(['guardar', temporaryDataDirectory('arcli-e2e-datos-'), 1, 1]);

    expect(await result(child)).toMatchObject({ errors: [], outcomes: { saved: 1 } });
    expect(child.output.stderr).toBe('');
  });

  it('los demás avisos siguen saliendo: otro experimental, uno de "SQLite" de otro tipo y uno común', async () => {
    const child = start(['avisos', temporaryDataDirectory('arcli-e2e-datos-')]);

    await child.closed;

    expect(lines(child)).toEqual(['ok']);
    expect(child.output.stderr).toContain('ExperimentalWarning: otro experimento');
    expect(child.output.stderr).toContain('DeprecationWarning: SQLite otro');
    expect(child.output.stderr).toContain('Warning: aviso común');
    expect(child.output.stderr).not.toContain('SQLite is an experimental feature');
  });
});

/** Los nombres de la carpeta de la base que son una dañada apartada. */
const setAsideNames = (file: string) => readdirSync(dirname(file)).filter((name) => name.includes('danada'));

/** Una base v1 con 3 comprobantes, cortada (a 100 bytes o a la mitad) y con fecha vieja: nadie la está creando. */
async function damagedBaseWith(cut: 'mitad' | '100 bytes'): Promise<{ dataDirectory: string; file: string }> {
  const base = await baseWith(3);

  cutFile(base.file, (size) => (cut === 'mitad' ? Math.floor(size / 2) : 100));
  makeOld(base.file);

  return base;
}

describe('copias y base dañada con procesos reales (ARQ-12 PR 4b)', () => {
  // VACUUM INTO lee en una transacción: la copia es una foto entera aunque otro escriba en el medio.
  it('las copias diarias salen sanas mientras otro proceso guarda cada 1 ms', async () => {
    const { dataDirectory, file } = await baseWith(50);
    const writer = start(['escritor', dataDirectory, 1000]);

    for (const deadline = Date.now() + HANG_MS; lines(writer).length < 20; await pause(2)) {
      if (exited(writer) || Date.now() > deadline) {
        throw new Error(`El escritor no guardó: ${writer.output.stderr.slice(-800)}`);
      }
    }

    const copied = await result(start(['copiar', dataDirectory, 7, 500]));

    expect(exited(writer)).toBe(false);
    await kill(writer);

    expect(copied).toMatchObject({ errors: [], outcomes: { saved: 7 } });

    // Solo las 7 copias: ningún temporal de VACUUM INTO quedó en la carpeta.
    const names = backupNames(dataDirectory);

    expect(names).toHaveLength(7);

    for (const name of names) {
      const copy = join(backupsFolder(dataDirectory), name);

      expect(health(copy)).toEqual({ integrity: 'ok', version: SCHEMA_V1 });
      expect(count(copy)).toBeGreaterThanOrEqual(50);
    }

    expect(health(file)).toEqual({ integrity: 'ok', version: SCHEMA_V1 });
  });

  // Los dos la ven dañada; uno la aparta y repone, y el otro no aparta la nueva (que está sana): abre esa y guarda.
  it.each(['100 bytes', 'mitad'] as const)(
    'dos procesos encuentran la base cortada (%s) a la vez: uno la aparta y el otro abre la nueva',
    async (cut) => {
      const { dataDirectory, file } = await damagedBaseWith(cut);
      const children = await together([
        ['guardar-uno', dataDirectory, 101],
        ['guardar-uno', dataDirectory, 102],
      ]);
      const results = await Promise.all(children.map(result));

      expect(results).toEqual([
        { outcome: expect.objectContaining({ kind: 'saved' }) },
        { outcome: expect.objectContaining({ kind: 'saved' }) },
      ]);
      expect(results.filter(({ outcome }) => (outcome as { recovered?: unknown }).recovered)).toHaveLength(1);
      expect(setAsideNames(file)).toHaveLength(1);
      expect(health(file)).toEqual({ integrity: 'ok', version: SCHEMA_V1 });
      expect(count(file)).toBe(2);
    },
  );

  // Revisión de #318: con tres o más, uno suelta el turno, otro lo toma y un tercero mira en el medio; nunca dos lo
  // tienen a la vez, así que hay una sola apartada.
  it('4 procesos encuentran la base cortada a la vez: exactamente una apartada y todos guardan', async () => {
    const { dataDirectory, file } = await damagedBaseWith('mitad');
    const children = await together([101, 102, 103, 104].map((numero) => ['guardar-uno', dataDirectory, numero]));
    const results = await Promise.all(children.map(result));

    expect(results).toEqual(Array.from({ length: 4 }, () => ({ outcome: expect.objectContaining({ kind: 'saved' }) })));
    expect(results.filter(({ outcome }) => (outcome as { recovered?: unknown }).recovered)).toHaveLength(1);
    expect(setAsideNames(file)).toHaveLength(1);
    expect(health(file)).toEqual({ integrity: 'ok', version: SCHEMA_V1 });
    expect(count(file)).toBe(4);
  });

  // En Windows SQLite abre la base sin dejar que otro la mueva: el que la encuentra dañada no puede apartarla.
  it.runIf(process.platform === 'win32')(
    'Windows: una dañada abierta por otro da damaged sin tocar, y cuando la cierra el siguiente la aparta',
    async () => {
      const { dataDirectory, file } = await damagedBaseWith('mitad');
      const holder = start(['abrir', file, HANG_MS]);

      await untilSays(holder, 'abierto');

      const before = fingerprint(file);

      expect(await result(start(['guardar-uno', dataDirectory, 101]))).toMatchObject({ error: { reason: 'damaged' } });
      expect(fingerprint(file)).toEqual(before);
      expect(setAsideNames(file)).toEqual([]);

      await kill(holder);

      expect(await result(start(['guardar-uno', dataDirectory, 102]))).toMatchObject({
        outcome: { kind: 'saved', recovered: { setAside: expect.stringMatching(/danada/) } },
      });
      expect(setAsideNames(file)).toHaveLength(1);
      expect(count(file)).toBe(1);
    },
  );
});

describe('el turno de la base con procesos reales (ARQ-12 PR 4b, revisión de #318)', () => {
  it('4 procesos que piden el turno a la vez nunca lo tienen dos juntos', async () => {
    const folder = temporaryDataDirectory('arcli-e2e-turno-');
    const lock = join(folder, '.turno-comprobantes.db');
    const marker = join(folder, 'adentro');
    const children = await together([1, 2, 3, 4].map(() => ['turno', lock, 25, marker]));

    for (const child of children) {
      expect(await result(child)).toEqual({ overlaps: 0 });
    }
  });

  // El bloqueo es del sistema: al morir el proceso se suelta, sin esperar a que el turno "se vuelva viejo".
  it('un proceso que muere con el turno lo suelta enseguida', async () => {
    const folder = temporaryDataDirectory('arcli-e2e-turno-');
    const lock = join(folder, '.turno-comprobantes.db');
    const holder = start(['tener-turno', lock]);

    await untilSays(holder, 'tomado');
    await kill(holder);

    const started = Date.now();

    expect(await result(start(['turno', lock, 1, join(folder, 'adentro')]))).toEqual({ overlaps: 0 });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  // Uno movió la base y murió antes de mover su -journal caliente: el journal no se reproduce sobre la base nueva.
  it('un -journal caliente que quedó sin su base se aparta con ella antes de reponer', async () => {
    const { dataDirectory, file } = await baseWith(3);
    const victim = start(['victima', file]);

    await untilSays(victim, 'medio');
    await kill(victim);

    const journal = `${file}-journal`;
    const hot = fingerprint(journal);
    const aside = join(dirname(file), 'comprobantes.danada-2026-11-26-120000.db');

    renameSync(file, aside);

    const saved = await result(start(['guardar-uno', dataDirectory, 101]));

    expect(saved).toMatchObject({ outcome: { kind: 'saved', recovered: { setAside: aside } } });
    expect(existsSync(journal)).toBe(false);
    expect(fingerprint(`${aside}-journal`).hash).toBe(hot.hash);
    expect(health(file)).toEqual({ integrity: 'ok', version: SCHEMA_V1 });
    expect(count(file)).toBe(1);
  });

  // Tercera pasada de #318: sin copias ni apartadas se crea vacía, pero el -journal caliente que quedó también se aparta.
  it('base borrada con su -journal caliente y sin copias: la nueva sale sana y el journal queda apartado', async () => {
    const { dataDirectory, file } = await baseWith(3);
    const victim = start(['victima', file]);

    await untilSays(victim, 'medio');
    await kill(victim);

    const journal = `${file}-journal`;
    const hot = fingerprint(journal);

    rmSync(file);

    expect(await result(start(['guardar-uno', dataDirectory, 101]))).toEqual({ outcome: { kind: 'saved' } });
    expect(existsSync(journal)).toBe(false);
    expect(health(file)).toEqual({ integrity: 'ok', version: SCHEMA_V1 });
    expect(count(file)).toBe(1);

    const [aside = ''] = readdirSync(dirname(file)).filter((name) => name.endsWith('.db-journal'));

    expect(aside).toMatch(/^comprobantes\.danada-.*\.db-journal$/);
    expect(fingerprint(join(dirname(file), aside)).hash).toBe(hot.hash);
  });
});

describe('restaurar con otro proceso escribiendo (ARQ-12 PR 4b)', () => {
  // La espera de SQLite es síncrona: hace falta otro proceso real. Uno sostiene BEGIN IMMEDIATE medio segundo; restaurar
  // espera (con la espera de siempre, 5 s) a que lo suelte y recién entonces aparta la actual.
  it('espera a que el otro suelte la base antes de apartarla', async () => {
    const dataDirectory = temporaryDataDirectory('arcli-e2e-datos-');
    const clock = { now: () => new Date('2026-11-26T15:00:00.000Z') };

    await openStore(dataDirectory, { backups: { enabled: true }, clock }).save(storeRecord(1));

    const file = vouchersFile(dataDirectory);
    const [copy = ''] = backupNames(dataDirectory).map((name) => join(backupsFolder(dataDirectory), name));
    const holder = start(['sostener', file, 500]);

    await untilSays(holder, 'tomado');

    const started = Date.now();
    const restored = await restoreVoucherBackup(
      { clock, cuit: '20111111112', dataDirectory, environment: 'testing', version: '9.9.9-test' },
      copy,
    );

    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    expect(restored.restoredFrom).toBe(copy);
    await untilSays(holder, 'soltado');
  });
});
