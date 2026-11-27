import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveCertificateFiles } from '../../../modules/certificates/certificate-store';
import { nodeCertificateStore } from '../certificate-store';

const {
  ensureFolder: ensureCertificateFolder,
  moveIfExists,
  readIfExists,
  readUnlessMissing,
  writePrivate: writePrivateFile,
} = nodeCertificateStore;

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

  // ARQ-27: una carpeta de solo lectura no gana escritura, salvo con la reparación explícita de `--reemplazar`.
  it.each([
    [false, '0500'],
    [true, '0700'],
  ])('con restoreAccess %s, la carpeta del CUIT en 0500 queda en %s', (restoreAccess, expected) => {
    const files = resolveCertificateFiles(temporaryFolder(), '20123456786', 'testing');

    mkdirSync(files.folder, { recursive: true });
    chmodSync(files.folder, 0o500);

    try {
      ensureCertificateFolder(files, { restoreAccess });

      expect(permissions(files.folder)).toBe(Number.parseInt(expected, 8));
    } finally {
      chmodSync(files.folder, 0o700);
    }
  });
});

// Caracterización antes de ARQ-12: estas operaciones pasan al adaptador de `CertificateStore` (services/files). Si se
// mudan, el test va con ellas.
describe('certificate-store: leer y mover', () => {
  afterEach(() => {
    directories.splice(0).forEach((directory) => rmSync(directory, { force: true, recursive: true }));
  });

  it('readUnlessMissing: sin el archivo o con un archivo en lugar de la carpeta, no hay nada que leer', () => {
    const folder = temporaryFolder();
    const notAFolder = join(folder, 'archivo');

    writeFileSync(notAFolder, 'x');

    expect(readUnlessMissing(join(folder, 'testing.nueva.key'))).toBeUndefined();
    expect(readUnlessMissing(join(notAFolder, 'testing.nueva.key'))).toBeUndefined();
  });

  it('readUnlessMissing lee el archivo; si es una carpeta, falla con su ruta', () => {
    const folder = temporaryFolder();
    const path = join(folder, 'testing.key');

    writeFileSync(path, 'clave');

    expect(readUnlessMissing(path)).toBe('clave');
    expect(() => readUnlessMissing(folder)).toThrow(expect.objectContaining({ code: 'EISDIR', path: folder }));
  });

  it.runIf(process.platform !== 'win32' && process.getuid?.() !== 0)(
    'readUnlessMissing sin permiso de lectura falla, no lo da por inexistente',
    () => {
      const folder = temporaryFolder();
      const path = join(folder, 'testing.nueva.key');

      writeFileSync(path, 'clave');
      chmodSync(path, 0o000);

      try {
        expect(() => readUnlessMissing(path)).toThrow(expect.objectContaining({ code: 'EACCES', path }));
      } finally {
        chmodSync(path, 0o600);
      }
    },
  );

  it('readIfExists: el contenido, o nada si no está', () => {
    const folder = temporaryFolder();
    const path = join(folder, 'testing.nueva.csr');

    expect(readIfExists(path)).toBeUndefined();
    writeFileSync(path, 'pedido');
    expect(readIfExists(path)).toBe('pedido');
  });

  it('moveIfExists pisa el destino y, sin origen, no toca nada', () => {
    const folder = temporaryFolder();
    const [from, to] = [join(folder, 'testing.crt'), join(folder, 'testing.anterior.crt')];

    writeFileSync(to, 'viejo');
    moveIfExists(from, to);
    expect(readFileSync(to, 'utf8')).toBe('viejo');

    writeFileSync(from, 'nuevo');
    moveIfExists(from, to);
    expect([existsSync(from), readFileSync(to, 'utf8')]).toEqual([false, 'nuevo']);
  });
});
