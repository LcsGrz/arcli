import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeNewFile } from '../write-new-file';

// `writeFileSync` pasa al real salvo en el caso de los 1000 intentos: crear 1000 archivos de verdad pasaba los 5 s en
// el CI de Windows (TEST-22).
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();

  return { ...original, writeFileSync: vi.fn(original.writeFileSync) };
});

const writeMock = vi.mocked(writeFileSync);

const directories: string[] = [];

afterEach(() => {
  // Vuelve al `writeFileSync` real (el que recibio `vi.fn`).
  writeMock.mockReset();

  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'arcli-write-new-file-'));

  directories.push(directory);

  return directory;
}

describe('writeNewFile', () => {
  it('escribe con el nombre pedido si no existe', () => {
    const path = join(createTempDir(), 'factura.pdf');

    expect(writeNewFile(path, new Uint8Array([1]))).toBe(path);
    expect(readFileSync(path)).toEqual(Buffer.from([1]));
  });

  it('nunca pisa un archivo existente: suma -2, -3', () => {
    const folder = createTempDir();
    const path = join(folder, 'factura.pdf');

    writeFileSync(path, 'original');

    expect(writeNewFile(path, new Uint8Array([2]))).toBe(join(folder, 'factura-2.pdf'));
    expect(writeNewFile(path, new Uint8Array([3]))).toBe(join(folder, 'factura-3.pdf'));
    expect(readFileSync(path, 'utf8')).toBe('original');
  });

  // TEST-19: un error que no es "ya existe" no se traga, y el tope de intentos es exacto.
  it('propaga un error que no es EEXIST en vez de dar el archivo por guardado', () => {
    const path = join(createTempDir(), 'no-existe', 'factura.pdf');

    expect(() => writeNewFile(path, new Uint8Array([1]))).toThrow(expect.objectContaining({ code: 'ENOENT' }));
    expect(existsSync(path)).toBe(false);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'propaga EACCES en una carpeta sin permiso de escritura',
    () => {
      const folder = createTempDir();

      chmodSync(folder, 0o500);

      try {
        expect(() => writeNewFile(join(folder, 'factura.pdf'), new Uint8Array([1]))).toThrow(
          expect.objectContaining({ code: 'EACCES' }),
        );
      } finally {
        chmodSync(folder, 0o700);
      }
    },
  );

  it('prueba hasta el intento 1000 y después falla', () => {
    const folder = join(tmpdir(), 'arcli-write-new-file-1000');
    const path = join(folder, 'factura.pdf');
    // Un disco en memoria con la misma regla que `wx`: si la ruta ya esta, EEXIST.
    const existing = new Set([
      path,
      ...Array.from({ length: 998 }, (_, index) => join(folder, `factura-${index + 2}.pdf`)),
    ]);

    writeMock.mockImplementation((file, _data, options) => {
      expect(options).toEqual({ flag: 'wx' });

      if (existing.has(String(file))) {
        throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      }

      existing.add(String(file));
    });

    expect(writeNewFile(path, new Uint8Array([1]))).toBe(join(folder, 'factura-1000.pdf'));
    writeMock.mockClear();
    expect(() => writeNewFile(path, new Uint8Array([1]))).toThrow(/ya existen 1000 archivos/);
    expect(writeMock).toHaveBeenCalledTimes(1000);
    expect(writeMock.mock.calls.map(([file]) => String(file))).not.toContain(join(folder, 'factura-1001.pdf'));
  });
});
