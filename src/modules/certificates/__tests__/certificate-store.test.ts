import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureCertificateFolder, resolveCertificateFiles, writePrivateFile } from '../certificate-store';

// `chmodSync` pasa al real salvo cuando un test lo apaga, para ver que el archivo ya nace en 0600.
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();

  return { ...original, chmodSync: vi.fn(original.chmodSync) };
});

const chmodMock = vi.mocked(chmodSync);
const directories: string[] = [];
let previousUmask: number;

function temporaryFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'arcli-certificate-store-'));

  directories.push(folder);

  return folder;
}

function permissions(path: string): number {
  return statSync(path).mode & 0o777;
}

// Los permisos POSIX no aplican en Windows: ahi la carpeta del usuario ya es solo suya (TEST-21).
describe.skipIf(process.platform === 'win32')('certificate-store: permisos de la clave privada', () => {
  beforeEach(() => {
    // Una umask comun (0644 para archivos nuevos): lo que restringe tiene que ser el codigo, no el entorno.
    previousUmask = process.umask(0o022);
  });

  afterEach(() => {
    process.umask(previousUmask);
    chmodMock.mockClear();
    directories.splice(0).forEach((directory) => rmSync(directory, { force: true, recursive: true }));
  });

  it('la clave nace en 0600, sin pasar por un momento legible por otros', () => {
    const path = join(temporaryFolder(), 'testing.key');

    chmodMock.mockImplementationOnce(() => undefined);
    writePrivateFile(path, 'clave');

    expect(permissions(path)).toBe(0o600);
  });

  it('una clave que ya existía con 0644 queda en 0600 al pisarla', () => {
    const path = join(temporaryFolder(), 'testing.key');

    writeFileSync(path, 'vieja', { mode: 0o644 });
    writePrivateFile(path, 'clave');

    expect(permissions(path)).toBe(0o600);
  });

  it('la carpeta de certificados queda en 0700, también si ya existía abierta', () => {
    const files = resolveCertificateFiles(temporaryFolder(), '20123456786', 'testing');

    mkdirSync(files.folder, { mode: 0o755 });
    chmodSync(files.folder, 0o755);
    ensureCertificateFolder(files);

    expect(permissions(files.folder)).toBe(0o700);
  });
});
