import * as fs from 'node:fs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fileIdentity } from '../database-file';

import { temporaryDataDirectory } from './local-data.fixtures';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();

  return { ...actual, statSync: vi.fn(actual.statSync) };
});

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');

afterEach(() => {
  vi.mocked(fs.statSync).mockImplementation(actualFs.statSync);
});

/**
 * Cómo ve Node en Windows dos archivos vecinos de un disco usado (ARQ-29, CI de #319): el inodo es el File ID de NTFS,
 * con el número de secuencia arriba, y pasa de 2^53; la fecha de creación es la misma (file system tunneling: NTFS le
 * pone al archivo nuevo la del que estaba en esa ruta).
 */
function asWindows(inodes: ReadonlyMap<string, bigint>): void {
  vi.mocked(fs.statSync).mockImplementation(((path: fs.PathLike, options?: fs.StatSyncOptions) => {
    const stats = actualFs.statSync(path, options);
    const ino = inodes.get(String(path));

    if (ino === undefined || stats === undefined) {
      return stats;
    }

    return options?.bigint
      ? Object.assign(stats, { birthtimeMs: 1n, birthtimeNs: 1_000_000n, ino })
      : Object.assign(stats, { birthtimeMs: 1, ino: Number(ino) });
  }) as typeof fs.statSync);
}

describe('fileIdentity (ARQ-29)', () => {
  it('distingue dos archivos cuyo inodo pasa de 2^53 y difiere en los bits bajos, con la misma fecha de creación', () => {
    const folder = temporaryDataDirectory();
    const [before, after] = [join(folder, 'antes.db'), join(folder, 'despues.db')];
    const nearInode = 0x0041_0000_0000_1234n;

    writeFileSync(before, '');
    writeFileSync(after, '');
    // Como number son el mismo: la que se movió y la que quedó en su lugar no se distinguían y no se volvía a mirar.
    expect(Number(nearInode)).toBe(Number(nearInode + 1n));
    asWindows(
      new Map([
        [before, nearInode],
        [after, nearInode + 1n],
      ]),
    );

    expect(fileIdentity(before)).not.toBe(fileIdentity(after));
  });

  it('el mismo archivo da la misma; uno que no está, undefined', () => {
    const file = join(temporaryDataDirectory(), 'base.db');

    writeFileSync(file, '');

    expect(fileIdentity(file)).toBe(fileIdentity(file));
    expect(fileIdentity(`${file}.otro`)).toBeUndefined();
  });
});
