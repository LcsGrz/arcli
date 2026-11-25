import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openConfigService } from '../cli/config-service';
import { dataDirectory } from '../cli/data-directory';
import { checkCliUpdate } from '../cli/update-check';
import { resolveConfigLocation } from '../modules/config/config.service';

import { assertConfigIsolated, isInsideDirectory } from './config-isolation';

const root = join(tmpdir(), 'arcli-test-abc');

describe('isInsideDirectory', () => {
  it('acepta la carpeta y lo que está adentro', () => {
    expect(isInsideDirectory(root, root)).toBe(true);
    expect(isInsideDirectory(root, join(root, 'arcli', 'config.json'))).toBe(true);
  });

  it('rechaza lo que está afuera, aunque empiece igual', () => {
    expect(isInsideDirectory(root, `${root}d`)).toBe(false);
    expect(isInsideDirectory(root, join(root, '..', 'arcli', 'config.json'))).toBe(false);
    expect(isInsideDirectory(root, join(tmpdir(), 'otra'))).toBe(false);
  });
});

describe('assertConfigIsolated', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('no hace nada si todas las rutas están en el temporal', () => {
    expect(() =>
      assertConfigIsolated(root, {
        configPath: join(root, 'arcli', 'config.json'),
        ticketPath: join(root, 'arcli', 'tickets'),
      }),
    ).not.toThrow();
  });

  it('falla nombrando cada ruta que queda afuera', () => {
    const real = join(tmpdir(), 'Library', 'Preferences', 'arcli');

    expect(() =>
      assertConfigIsolated(root, { configPath: join(real, 'config.json'), ticketPath: join(real, 'tickets') }),
    ).toThrow(/configPath: .*config\.json, ticketPath: .*tickets no está dentro de la carpeta temporal/);
  });

  it('falla con la resolución real si ARCLI_CONFIG_DIR apunta afuera del temporal', () => {
    const home = process.env.HOME ?? '';

    vi.stubEnv('ARCLI_CONFIG_DIR', `${home}-afuera`);

    expect(() => assertConfigIsolated(home, resolveConfigLocation({ cwd: dataDirectory() }))).toThrow(
      /no está dentro de la carpeta temporal/,
    );
  });

  it.each([undefined, '', '  '])(
    'con ARCLI_CONFIG_DIR en %j, abrir datos falla en vez de usar la real',
    async (value) => {
      vi.stubEnv('ARCLI_CONFIG_DIR', value);

      const { signal } = new AbortController();

      expect(() => dataDirectory()).toThrow(/no usan la carpeta de datos real/);
      expect(() => openConfigService()).toThrow(/no usan la carpeta de datos real/);
      await expect(checkCliUpdate({ signal })).rejects.toThrow(/no usan la carpeta de datos real/);
    },
  );

  it('con el setup de la suite, la config y los tickets quedan en el temporal', () => {
    const home = process.env.HOME ?? '';
    const location = resolveConfigLocation({ cwd: dataDirectory() });

    expect(home.startsWith(tmpdir())).toBe(true);
    expect(location).toEqual({
      configPath: join(home, 'arcli', 'config.json'),
      ticketPath: join(home, 'arcli', 'tickets'),
    });
    expect(() => assertConfigIsolated(home, location)).not.toThrow();
  });
});
