import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { restrictFolderToOwner } from '../restrict-to-owner';

// `chmodSync` pasa al real salvo cuando un test lo hace fallar, como en una carpeta de otro usuario.
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();

  return { ...original, chmodSync: vi.fn(original.chmodSync) };
});

const chmodMock = vi.mocked(chmodSync);
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
});
