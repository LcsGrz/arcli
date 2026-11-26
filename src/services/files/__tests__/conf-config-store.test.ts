import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveConfigLocation } from '../../../modules/config/config.service';
import { openConfConfigStore, openConfigFileStore } from '../conf-config-store';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arcli-config-store-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('openConfConfigStore', () => {
  it('la ruta del config.json es la que vigila el setup de los tests', () => {
    expect(openConfigFileStore(dir).path).toBe(resolveConfigLocation({ cwd: dir }).configPath);
  });

  it('armarlo no lee ni crea nada: los errores salen al leer', () => {
    const missing = join(dir, 'nueva');
    const broken = join(dir, 'rota');

    openConfigFileStore(missing);
    expect(existsSync(missing)).toBe(false);

    writeFileSync(join(dir, 'config.json'), '{ esto no es JSON');
    writeFileSync(broken, '');

    const store = openConfigFileStore(dir);

    expect(() => store.read()).toThrow(SyntaxError);
    expect(() => openConfigFileStore(broken).read()).toThrow(/ENOTDIR|EEXIST/);
  });

  it('update relee, escribe lo que devuelve y no escribe si devuelve undefined', () => {
    const store = openConfConfigStore({ configName: 'prueba', cwd: dir, invalid: 'throw' });

    store.update(() => undefined);
    expect(existsSync(store.path)).toBe(false);

    writeFileSync(store.path, '{"otra": 1}');
    store.update((saved) => ({ ...saved, nueva: 2 }));

    expect(readFileSync(store.path, 'utf8')).toBe('{\n\t"otra": 1,\n\t"nueva": 2\n}');
  });

  it('si el cambio lanza, no escribe', () => {
    const store = openConfConfigStore({ configName: 'prueba', cwd: dir, invalid: 'throw' });

    writeFileSync(store.path, '{"otra": 1}');

    expect(() =>
      store.update(() => {
        throw new Error('inválido');
      }),
    ).toThrow('inválido');
    expect(readFileSync(store.path, 'utf8')).toBe('{"otra": 1}');
  });

  it('un caché roto se lee como vacío', () => {
    const store = openConfConfigStore({ configName: 'cache', cwd: dir, invalid: 'empty' });

    writeFileSync(store.path, '{ esto no es JSON');

    expect(store.read()).toEqual({});
  });
});
