import { existsSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { withDatabaseLock } from '../database-lock';

import { temporaryDataDirectory } from './local-data.fixtures';

/**
 * El turno de una base (ARQ-12 PR 4b): crear, apartar y reponer, y restaurar van de a uno. Lo de dos procesos reales
 * que encuentran la base dañada a la vez está en data.e2e.ts.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

function lockedFolder(): { file: string; lock: string } {
  const folder = temporaryDataDirectory();
  const lock = join(folder, '.bloqueo-comprobantes.db');

  writeFileSync(lock, '');

  return { file: join(folder, 'comprobantes.db'), lock };
}

describe('el turno de la base (ARQ-12 PR 4b)', () => {
  it('lo toma, corre y lo suelta, también si lo que corre falla', async () => {
    const folder = temporaryDataDirectory();
    const file = join(folder, 'comprobantes.db');
    const lock = join(folder, '.bloqueo-comprobantes.db');

    await expect(withDatabaseLock(file, () => existsSync(lock))).resolves.toBe(true);
    expect(existsSync(lock)).toBe(false);

    await expect(
      withDatabaseLock(file, () => {
        throw new Error('falló adentro');
      }),
    ).rejects.toThrow('falló adentro');
    expect(existsSync(lock)).toBe(false);
  });

  it('si lo tiene otro, espera a que lo suelte sin bloquear el proceso', async () => {
    const { file, lock } = lockedFolder();
    const order: string[] = [];
    const released = setTimeout(200).then(() => {
      order.push('el otro lo suelta');
      rmSync(lock);
    });

    await withDatabaseLock(file, () => order.push('corre'));
    await released;

    expect(order).toEqual(['el otro lo suelta', 'corre']);
    expect(existsSync(lock)).toBe(false);
  });

  // Un proceso que murió con el turno lo deja: a los 30 s se toma.
  it('uno viejo se toma enseguida', async () => {
    const { file, lock } = lockedFolder();
    const minuteAgo = new Date(Date.now() - 60_000);

    utimesSync(lock, minuteAgo, minuteAgo);

    const started = Date.now();

    await expect(withDatabaseLock(file, () => 'corrió')).resolves.toBe('corrió');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(existsSync(lock)).toBe(false);
  });

  it('si no llega a tenerlo, locked sin correr nada y sin tocar el del otro', async () => {
    const { file, lock } = lockedFolder();
    const start = Date.now();
    // El del otro es reciente para cualquier reloj del test; el reloj salta más allá de la espera.
    const later = new Date(start + 3_600_000);

    utimesSync(lock, later, later);
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(start)
      .mockReturnValue(start + 41_000);

    const work = vi.fn();

    await expect(withDatabaseLock(file, work)).rejects.toMatchObject({ name: 'LocalDataError', reason: 'locked' });
    expect(work).not.toHaveBeenCalled();
    expect(existsSync(lock)).toBe(true);
  });

  it('otro error al pedirlo sale como vino', async () => {
    const file = join(temporaryDataDirectory(), 'no-existe', 'comprobantes.db');

    await expect(withDatabaseLock(file, vi.fn())).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
