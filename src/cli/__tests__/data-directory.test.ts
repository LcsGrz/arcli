import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadMonotributoTable } from '../../modules/monotributo/monotributo.service';
import { checkForUpdate } from '../../modules/update-check/update-check.service';
import { FileMonotributoStore } from '../../services/files/monotributo-file-store';
import { openConfigService, withConfigService } from '../config-service';
import { dataDirectory } from '../data-directory';
import { loadMonotributoReport } from '../monotributo-report';
import { checkCliUpdate } from '../update-check';

vi.mock('env-paths', () => ({
  default: (name: string, options: { suffix: string }) => ({ config: `/de-siempre/${name}${options.suffix}` }),
}));
vi.mock('../../modules/update-check/update-check.service', () => ({ checkForUpdate: vi.fn(async () => null) }));
vi.mock('../../modules/monotributo/monotributo.service', () => ({
  loadMonotributoTable: vi.fn(async () => ({})),
  resolveOwnCategory: vi.fn(async () => undefined),
}));

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'arcli-config-dir-'));
  vi.stubEnv('ARCLI_CONFIG_DIR', directory);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { force: true, recursive: true });
});

describe('dataDirectory', () => {
  it.each([undefined, '', '  '])('con ARCLI_CONFIG_DIR en %j, es la de siempre', (value) => {
    vi.stubEnv('ARCLI_CONFIG_DIR', value);

    expect(dataDirectory()).toBe('/de-siempre/arcli');
  });

  it('con la variable, esa sin espacios alrededor, y se lee en cada llamada', () => {
    vi.stubEnv('ARCLI_CONFIG_DIR', ` ${directory} `);
    expect(dataDirectory()).toBe(directory);

    vi.stubEnv('ARCLI_CONFIG_DIR', 'relativa');
    expect(dataDirectory()).toBe(resolve('relativa'));
  });
});

describe('quien abre datos usa esa carpeta', () => {
  it('la config y sus carpetas', () => {
    withConfigService((service) => {
      expect(service.getPath()).toBe(join(directory, 'config.json'));
      expect(service.getDefaultTicketPath()).toBe(join(directory, 'tickets'));
      expect(service.getPluginsPath()).toBe(join(directory, 'plugins'));
      expect(service.getCertificatesPath()).toBe(join(directory, 'certificados'));
    });
  });

  it('withConfigService cierra la config aunque la operación falle', () => {
    const service = openConfigService();
    const close = vi.spyOn(Object.getPrototypeOf(service) as typeof service, 'close');

    service.close();
    close.mockClear();

    expect(() =>
      withConfigService(() => {
        throw new Error('falló');
      }),
    ).toThrow('falló');
    expect(close).toHaveBeenCalledOnce();
    close.mockRestore();
  });

  it('withConfigService no acepta una operación async, por tipo', async () => {
    // @ts-expect-error la config se cerraria antes de que termine.
    await withConfigService(async () => 1);
    // @ts-expect-error lo mismo con una promesa a veces.
    await withConfigService((service) => (service.getPath() ? Promise.resolve(1) : 2));

    const path: string = withConfigService((service) => service.getPath());

    expect(path).toBe(join(directory, 'config.json'));
  });

  it('el caché de la versión', async () => {
    const { signal } = new AbortController();

    await checkCliUpdate({ maxAgeMs: 0, signal });

    expect(checkForUpdate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ cwd: directory, maxAgeMs: 0, request: expect.any(Function), signal }),
    );
  });

  it('el caché del monotributo', async () => {
    new FileMonotributoStore(directory).saveFirstAttempt('20261125');
    await loadMonotributoReport({
      createArca: () => {
        throw new Error('no va a ARCA');
      },
      environment: 'testing',
      quiet: true,
      refresh: false,
    });

    expect(vi.mocked(loadMonotributoTable).mock.calls[0]?.[0].store.readFirstAttempt()).toBe('20261125');
  });

  it('el del monotributo queda en memoria si la carpeta no se puede usar', async () => {
    const file = join(directory, 'archivo');

    writeFileSync(file, '');
    vi.stubEnv('ARCLI_CONFIG_DIR', file);
    vi.mocked(loadMonotributoTable).mockClear();
    await loadMonotributoReport({
      createArca: () => {
        throw new Error('no va a ARCA');
      },
      environment: 'testing',
      quiet: true,
      refresh: false,
    });

    expect(vi.mocked(loadMonotributoTable).mock.calls[0]?.[0].store).not.toBeInstanceOf(FileMonotributoStore);
  });
});
