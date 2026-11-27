import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTemporaryFile } from '../database-temporary';

import { permissions, temporaryDataDirectory, vouchersFile, withPermissions } from './local-data.fixtures';

// El nombre al azar y la apertura del temporal se pueden fijar en un test: dos procesos con el mismo nombre, un error.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();

  return { ...actual, randomBytes: vi.fn(actual.randomBytes) };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();

  return { ...actual, openSync: vi.fn(actual.openSync) };
});

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');

afterEach(() => {
  vi.mocked(fs.openSync).mockImplementation(actualFs.openSync);
});

function baseFolder(): string {
  const file = vouchersFile(temporaryDataDirectory());

  mkdirSync(dirname(file), { recursive: true });

  return file;
}

describe('createTemporaryFile (ARQ-12)', () => {
  it('si el nombre ya está (otro proceso), prueba otro y no pisa el ajeno', () => {
    const file = baseFolder();
    const taken = join(dirname(file), '.nueva-00000000');

    writeFileSync(taken, 'del otro');
    vi.mocked(crypto.randomBytes)
      .mockImplementationOnce(() => Buffer.alloc(4, 0))
      .mockImplementationOnce(() => Buffer.alloc(4, 0xab));

    expect(createTemporaryFile(file)).toBe(join(dirname(file), '.nueva-abababab'));
    expect(actualFs.readFileSync(taken, 'utf8')).toBe('del otro');
  });

  it('otro error al crearlo sale enseguida, sin reintentar', () => {
    const file = baseFolder();

    vi.mocked(fs.openSync).mockImplementation(() => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    });

    expect(() => createTemporaryFile(file)).toThrow(expect.objectContaining({ code: 'EACCES' }));
    expect(fs.openSync).toHaveBeenCalledTimes(1);
    expect(readdirSync(dirname(file))).toEqual([]);
  });

  // Con una umask que saca hasta la escritura del dueño (0277), SQLite no podría armar la base: el temporal queda 0600.
  it.runIf(withPermissions)('sale 0600 aunque la umask saque la escritura del dueño', () => {
    const file = baseFolder();
    const previous = process.umask(0o277);

    try {
      expect(permissions(createTemporaryFile(file))).toBe(0o600);
    } finally {
      process.umask(previous);
    }
  });

  it('mide lo mismo que el nombre de la base, también el de clientes.db', () => {
    const vouchers = baseFolder();
    const clients = join(dirname(dirname(vouchers)), 'clientes.db');

    expect(createTemporaryFile(vouchers)).toHaveLength(vouchers.length);
    expect(createTemporaryFile(clients)).toHaveLength(clients.length);
  });
});
