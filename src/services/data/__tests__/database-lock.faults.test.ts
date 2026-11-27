import * as fs from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { withDatabaseLock } from '../database-lock';

import { temporaryDataDirectory } from './local-data.fixtures';

/**
 * Carreras del turno de la base que no se arman sin meterse en `node:fs` (revisión de #318): otro proceso suelta o
 * toma el turno justo entre dos llamadas de este.
 */
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();

  return { ...actual, openSync: vi.fn(actual.openSync), renameSync: vi.fn(actual.renameSync) };
});

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');

afterEach(() => {
  vi.mocked(fs.openSync).mockImplementation(actualFs.openSync);
  vi.mocked(fs.renameSync).mockImplementation(actualFs.renameSync);
});

function lockedFolder(): { file: string; lock: string } {
  const folder = temporaryDataDirectory();
  const lock = join(folder, '.bloqueo-comprobantes.db');

  actualFs.writeFileSync(lock, 'H');

  return { file: join(folder, 'comprobantes.db'), lock };
}

describe('el turno de la base con otros procesos en el medio (revisión de #318)', () => {
  // H suelta, W2 lo toma y este (W1) ve ENOENT en el hueco: no tiene que borrar el de W2.
  it('si el turno desaparece mientras se mira y otro lo toma, se espera a ese', async () => {
    const { file, lock } = lockedFolder();
    let othersTurn = false;

    let looked = false;

    // La primera vez que mira el turno (abrirlo para leer), el de H ya no está y W2 toma el suyo.
    vi.mocked(fs.openSync).mockImplementation(((path: fs.PathLike, flags?: fs.OpenMode, mode?: fs.Mode) => {
      if (!looked && flags === 'r' && String(path) === lock) {
        looked = true;
        actualFs.rmSync(lock);
        actualFs.writeFileSync(lock, 'W2');
        othersTurn = true;
        throw Object.assign(new Error(`ENOENT: no such file or directory, open '${String(path)}'`), { code: 'ENOENT' });
      }

      return actualFs.openSync(path, flags ?? 'r', mode);
    }) as typeof fs.openSync);

    const released = setTimeout(300).then(() => {
      expect(actualFs.readFileSync(lock, 'utf8')).toBe('W2');
      othersTurn = false;
      actualFs.rmSync(lock);
    });

    await withDatabaseLock(file, () => {
      expect(othersTurn).toBe(false);
    });
    await released;
  });

  // Uno viejo se saca, pero si en el medio otro lo soltó y tomó uno nuevo, ese no se toca. En Linux el nuevo puede
  // tener el mismo inodo que el viejo (se reusa enseguida, CI de #318): acá es el mismo archivo, con otra marca.
  it.each([
    ['otro inodo', true],
    ['el mismo inodo reusado', false],
  ])(
    'al sacar uno viejo, si en el medio hay uno nuevo de otro (%s), se le devuelve y se espera',
    async (_name, newInode) => {
      const { file, lock } = lockedFolder();
      const old = new Date(Date.now() - 60_000);
      let othersTurn = false;

      actualFs.utimesSync(lock, old, old);
      vi.mocked(fs.renameSync).mockImplementationOnce((from, to) => {
        if (newInode) {
          actualFs.rmSync(lock);
        }

        actualFs.writeFileSync(lock, 'nuevo');
        othersTurn = true;
        actualFs.renameSync(from, to);
      });

      const released = setTimeout(300).then(() => {
        expect(actualFs.readFileSync(lock, 'utf8')).toBe('nuevo');
        othersTurn = false;
        actualFs.rmSync(lock);
      });

      await withDatabaseLock(file, () => {
        expect(othersTurn).toBe(false);
      });
      await released;
    },
  );

  // Al soltar no se borra uno que no es el propio (se lo sacaron por viejo y otro tomó el suyo).
  it('al soltar, uno que no es el propio queda', async () => {
    const folder = temporaryDataDirectory();
    const lock = join(folder, '.bloqueo-comprobantes.db');

    await withDatabaseLock(join(folder, 'comprobantes.db'), () => {
      actualFs.rmSync(lock);
      actualFs.writeFileSync(lock, 'de otro');
    });

    expect(actualFs.readFileSync(lock, 'utf8')).toBe('de otro');
  });
});
