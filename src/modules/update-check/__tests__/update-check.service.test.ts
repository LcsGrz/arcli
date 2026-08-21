import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkForUpdate } from '../update-check.service';

const temporaryDirectories: string[] = [];
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
