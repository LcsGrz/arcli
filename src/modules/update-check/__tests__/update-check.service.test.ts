import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkForUpdate, isNewerVersion } from '../update-check.service';

const temporaryDirectories: string[] = [];
/** Para que `Date.now()` avance. */
const pause = () => new Promise((resolve) => setTimeout(resolve, 5));
let originalStderrIsTty: boolean | undefined;

function createCwd(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'arcli-update-check-test-'));

  temporaryDirectories.push(cwd);

  return cwd;
}

function mockRegistryResponse(version: string | null): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      version === null ? { json: async () => ({}), ok: false } : { json: async () => ({ version }), ok: true },
    ),
  );
}

beforeEach(() => {
  originalStderrIsTty = process.stderr.isTTY;
  Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: true });
  vi.stubEnv('CI', '');
  vi.stubEnv('NO_UPDATE_NOTIFIER', '');
});

afterEach(() => {
  Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: originalStderrIsTty });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('checkForUpdate', () => {
  it('devuelve null cuando no corre en una terminal interactiva', async () => {
    Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: false });
    mockRegistryResponse('99.0.0');

    const result = await checkForUpdate('0.1.0', { cwd: createCwd() });

    expect(result).toBeNull();
  });

  it('devuelve null cuando esta deshabilitado por CI', async () => {
    vi.stubEnv('CI', 'true');
    mockRegistryResponse('99.0.0');

    const result = await checkForUpdate('0.1.0', { cwd: createCwd() });

    expect(result).toBeNull();
  });

  it('devuelve la version nueva cuando el registry tiene una version mas reciente', async () => {
    mockRegistryResponse('0.2.0');

    const result = await checkForUpdate('0.1.0', { cwd: createCwd() });

    expect(result).toEqual({ currentVersion: '0.1.0', latestVersion: '0.2.0' });
  });

  it('devuelve null cuando la version instalada ya es la mas reciente', async () => {
    mockRegistryResponse('0.1.0');

    const result = await checkForUpdate('0.1.0', { cwd: createCwd() });

    expect(result).toBeNull();
  });

  it('no vuelve a golpear el registry si el cache todavia es valido', async () => {
    const cwd = createCwd();
    mockRegistryResponse('0.2.0');

    await checkForUpdate('0.1.0', { cwd });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const result = await checkForUpdate('0.1.0', { cwd });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ currentVersion: '0.1.0', latestVersion: '0.2.0' });
  });

  it('devuelve null si la consulta al registry falla', async () => {
    mockRegistryResponse(null);

    const result = await checkForUpdate('0.1.0', { cwd: createCwd() });

    expect(result).toBeNull();
  });
});

// Con la 3.0.0 planeada, un error en la comparacion de major dejaria a todos sin aviso (TEST-21).
describe('isNewerVersion', () => {
  it.each([
    ['3.0.0', '2.5.2', true],
    ['2.5.2', '3.0.0', false],
    ['10.0.0', '9.9.9', true],
    ['2.6.0', '2.5.9', true],
    ['2.5.9', '2.6.0', false],
    ['2.5.3', '2.5.2', true],
    ['2.5.2', '2.5.3', false],
    ['2.5.2', '2.5.2', false],
  ])('%s contra la instalada %s: %s', (latest, current, expected) => {
    expect(isNewerVersion(latest, current)).toBe(expected);
  });
});

describe('checkForUpdate: cache', () => {
  it('si la consulta falla, mantiene la version cacheada y la sigue avisando', async () => {
    const cwd = createCwd();

    mockRegistryResponse('0.2.0');
    await checkForUpdate('0.1.0', { cwd });

    mockRegistryResponse(null);
    expect(await checkForUpdate('0.1.0', { cwd, maxAgeMs: -1 })).toEqual({
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
    });
  });

  it('una respuesta sin `ok` no cuenta aunque traiga una version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => ({ version: '9.0.0' }), ok: false })),
    );

    expect(await checkForUpdate('0.1.0', { cwd: createCwd() })).toBeNull();
  });
});

/** El comando termino y no se espera a npm (TUI-49). */
describe('checkForUpdate: cancelada', () => {
  /** npm colgado: contesta solo si lo cancelan, como el `fetch` de verdad. */
  function hangRegistry() {
    const request = vi.fn(
      (_url: string, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const fail = () => reject(new DOMException('cancelada', 'AbortError'));

          if (signal.aborted) {
            fail();
          } else {
            signal.addEventListener('abort', fail);
          }
        }),
    );

    vi.stubGlobal('fetch', request);

    return request;
  }

  function cancelled(cwd: string, currentVersion = '0.1.0') {
    const controller = new AbortController();
    const result = checkForUpdate(currentVersion, { cwd, maxAgeMs: -1, signal: controller.signal } as object);

    controller.abort();

    return result;
  }

  const cached = (cwd: string) =>
    JSON.parse(readFileSync(join(cwd, 'update-cache.json'), 'utf8')) as Record<string, number | string>;

  it.fails('no avisa, no anota la consulta y la próxima reintenta', async () => {
    const cwd = createCwd();

    hangRegistry();
    expect(await cancelled(cwd)).toBeNull();
    expect(existsSync(join(cwd, 'update-cache.json')) ? cached(cwd).lastCheckedAt : 0).toBe(0);

    mockRegistryResponse('0.2.0');
    expect(await checkForUpdate('0.1.0', { cwd })).toMatchObject({ latestVersion: '0.2.0' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.fails('con una más nueva ya guardada, avisa con esa', async () => {
    const cwd = createCwd();

    mockRegistryResponse('0.2.0');
    await checkForUpdate('0.1.0', { cwd });

    const before = cached(cwd);

    hangRegistry();
    await pause();
    expect(await cancelled(cwd)).toEqual({ currentVersion: '0.1.0', latestVersion: '0.2.0' });
    expect(cached(cwd)).toEqual(before);
    expect(await cancelled(cwd, '0.2.0')).toBeNull();
  });

  it('una falla de npm se anota igual que siempre, también si después se cancela', async () => {
    const cwd = createCwd();
    const controller = new AbortController();

    vi.stubGlobal('fetch', async () => Promise.reject(new Error('sin red')));
    expect(await checkForUpdate('0.1.0', { cwd, signal: controller.signal } as object)).toBeNull();
    controller.abort();
    expect(cached(cwd).lastCheckedAt).toBeGreaterThan(0);
  });

  it('una respuesta que llegó antes de cancelar se guarda', async () => {
    const cwd = createCwd();
    const controller = new AbortController();

    mockRegistryResponse('0.2.0');
    await checkForUpdate('0.1.0', { cwd, signal: controller.signal } as object);
    controller.abort();
    expect(cached(cwd)).toMatchObject({ latestVersion: '0.2.0' });
  });

  it('sin respuesta en 1,5 segundos se anota, como siempre', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    try {
      const cwd = createCwd();

      hangRegistry();

      const result = checkForUpdate('0.1.0', { cwd });

      await vi.advanceTimersByTimeAsync(1500);
      expect(await result).toBeNull();
      expect(cached(cwd).lastCheckedAt).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
