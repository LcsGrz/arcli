import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { restrictFolderToOwner } from '../restrict-to-owner';

// `chmodSync` pasa al real salvo cuando un test lo hace fallar, como en una carpeta de otro usuario.
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();

  return { ...original, chmodSync: vi.fn(original.chmodSync), statSync: vi.fn(original.statSync) };
});

const chmodMock = vi.mocked(chmodSync);
const statMock = vi.mocked(statSync);
/** Root puede con todo: una carpeta de solo lectura no lo frena. */
const withPermissions = process.getuid?.() !== 0;
const directories: string[] = [];

afterEach(() => {
  chmodMock.mockClear();

  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe.skipIf(process.platform === 'win32')('restrictFolderToOwner', () => {
  it('leaves an existing folder only for its owner', () => {
    const root = mkdtempSync(join(tmpdir(), 'arcli-perms-'));
    const tickets = join(root, 'tickets');

    directories.push(root);
    mkdirSync(tickets, { mode: 0o755 });
    writeFileSync(join(tickets, 'TA-20123456786-wsfe.json'), '{}', { mode: 0o644 });

    restrictFolderToOwner(tickets);

    expect(statSync(tickets).mode & 0o777).toBe(0o700);
  });

  // ARQ-27: saca grupo y otros, pero no le devuelve al dueno lo que se saco a proposito (una carpeta de solo lectura).
  it.each([
    ['0755', '0700'],
    ['0750', '0700'],
    ['0700', '0700'],
    ['0500', '0500'],
    ['0555', '0500'],
  ])('una carpeta en %s queda en %s', (beforeLabel, afterLabel) => {
    const [before, after] = [Number.parseInt(beforeLabel, 8), Number.parseInt(afterLabel, 8)];
    const root = mkdtempSync(join(tmpdir(), 'arcli-perms-'));
    const folder = join(root, 'datos');

    directories.push(root);
    mkdirSync(folder);
    chmodSync(folder, before);

    try {
      restrictFolderToOwner(folder);

      expect(statSync(folder).mode & 0o777).toBe(after);
    } finally {
      chmodSync(folder, 0o700);
    }
  });

  it.runIf(withPermissions)('una carpeta de solo lectura sigue sin dejar crear archivos', () => {
    const root = mkdtempSync(join(tmpdir(), 'arcli-perms-'));

    directories.push(root);
    chmodSync(root, 0o500);

    try {
      restrictFolderToOwner(root);

      expect(() => writeFileSync(join(root, 'comprobantes.db'), '')).toThrow(
        expect.objectContaining({ code: 'EACCES' }),
      );
    } finally {
      chmodSync(root, 0o700);
    }
  });

  it('ignores a folder that does not exist', () => {
    expect(() => restrictFolderToOwner(join(tmpdir(), 'arcli-no-existe', 'tickets'))).not.toThrow();
  });

  // Caracterización antes de ARQ-12: la función pasa a services/files y esto tiene que seguir igual.
  it('si chmod falla (carpeta de otro usuario, disco sin permisos POSIX), sigue sin tocarla', () => {
    const root = mkdtempSync(join(tmpdir(), 'arcli-perms-'));

    directories.push(root);
    chmodSync(root, 0o755);
    chmodMock.mockImplementationOnce(() => {
      throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM', syscall: 'chmod' });
    });

    expect(() => restrictFolderToOwner(root)).not.toThrow();
    expect(chmodMock).toHaveBeenLastCalledWith(root, 0o700);
    expect(statSync(root).mode & 0o777).toBe(0o755);
  });

  it('si no puede leer los permisos de la carpeta, sigue sin tocarla', () => {
    const root = mkdtempSync(join(tmpdir(), 'arcli-perms-'));

    directories.push(root);
    chmodSync(root, 0o755);
    chmodMock.mockClear();
    statMock.mockImplementationOnce(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES', syscall: 'stat' });
    });

    expect(() => restrictFolderToOwner(root)).not.toThrow();
    expect(chmodMock).not.toHaveBeenCalled();
    expect(statSync(root).mode & 0o777).toBe(0o755);
  });
});
