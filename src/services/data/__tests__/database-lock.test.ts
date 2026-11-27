import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { withDatabaseLock } from '../database-lock';
import { loadSqliteDriver, openSqliteConnection } from '../sqlite-driver';

import { permissions, temporaryDataDirectory, withPermissions } from './local-data.fixtures';

/**
 * El turno de una base (ARQ-12 PR 4b, revisión de #318): un `BEGIN EXCLUSIVE` sobre `.turno-<base>`, que el sistema
 * suelta solo si el proceso muere. Lo de varios procesos reales y un SIGKILL con el turno tomado está en data.e2e.ts.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

function folderWithBase(): { lock: string } {
  const folder = temporaryDataDirectory();

  return { lock: join(folder, '.turno-comprobantes.db') };
}

describe('el turno de la base (ARQ-12 PR 4b)', () => {
  it('lo toma, corre y lo suelta, también si lo que corre falla', async () => {
    const driver = await loadSqliteDriver();
    const { lock } = folderWithBase();

    await expect(withDatabaseLock(driver, lock, () => 'corrió')).resolves.toBe('corrió');
    await expect(
      withDatabaseLock(driver, lock, () => {
        throw new Error('falló adentro');
      }),
    ).rejects.toThrow('falló adentro');

    const started = Date.now();

    await expect(withDatabaseLock(driver, lock, () => 'de nuevo')).resolves.toBe('de nuevo');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it.runIf(withPermissions)('el archivo del turno queda solo para el dueño', async () => {
    const { lock } = folderWithBase();

    await withDatabaseLock(await loadSqliteDriver(), lock, () => undefined);

    expect(permissions(lock)).toBe(0o600);
  });

  it('si lo tiene otro, espera a que lo suelte sin bloquear el proceso', async () => {
    const driver = await loadSqliteDriver();
    const { lock } = folderWithBase();

    await withDatabaseLock(driver, lock, () => undefined);

    const holder = await openSqliteConnection(lock, { timeoutMs: 100 });
    const order: string[] = [];

    holder.exec('BEGIN EXCLUSIVE');

    const released = setTimeout(300).then(() => {
      order.push('el otro lo suelta');
      holder.exec('ROLLBACK');
      holder.close();
    });

    await withDatabaseLock(driver, lock, () => order.push('corre'));
    await released;

    expect(order).toEqual(['el otro lo suelta', 'corre']);
  });

  it('si no llega a tenerlo, locked sin correr nada', async () => {
    const driver = await loadSqliteDriver();
    const { lock } = folderWithBase();

    await withDatabaseLock(driver, lock, () => undefined);

    const holder = await openSqliteConnection(lock, { timeoutMs: 100 });
    const start = Date.now();
    const work = vi.fn();

    holder.exec('BEGIN EXCLUSIVE');
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(start)
      .mockReturnValue(start + 41_000);

    try {
      await expect(withDatabaseLock(driver, lock, work)).rejects.toMatchObject({
        name: 'LocalDataError',
        reason: 'locked',
      });
    } finally {
      holder.exec('ROLLBACK');
      holder.close();
    }

    expect(work).not.toHaveBeenCalled();
  });

  it('otro error al pedirlo sale como vino', async () => {
    const lock = join(temporaryDataDirectory(), 'no-existe', '.turno-comprobantes.db');

    await expect(withDatabaseLock(await loadSqliteDriver(), lock, vi.fn())).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
