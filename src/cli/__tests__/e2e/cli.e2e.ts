import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { VOUCHER_SHORTCUTS } from '../../../modules/billing/voucher-kind-map';
import { EXPORT_VOUCHER_KINDS } from '../../../modules/export/export.types';

/**
 * El `arcli` compilado, como lo usa la gente: un proceso aparte, con su salida, su JSON y su exit code. Sin red ni
 * certificados: cada test usa una carpeta de config vacia con `ARCLI_CONFIG_DIR`. Corre con `yarn test:e2e`,
 * despues de `yarn build`.
 */
const CLI = resolve('dist/cli/index.js');
const VERSION = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;

let configDir = '';

interface Run {
  readonly code: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

function run(...args: string[]): Run {
  const result: SpawnSyncReturns<string> = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ARCLI_CONFIG_DIR: configDir,
      FORCE_COLOR: '0',
      // Sin esto, el HOME real podria aportar tickets o certificados.
      HOME: configDir,
      NO_UPDATE_NOTIFIER: '1',
      USERPROFILE: configDir,
    },
    timeout: 30_000,
  });

  return { code: result.status, stderr: result.stderr, stdout: result.stdout };
}

/** Todo stdout (o stderr) tiene que ser un solo documento JSON, no JSON con texto alrededor. */
function json(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

beforeAll(() => {
  if (!existsSync(CLI)) {
    throw new Error('No está dist/cli/index.js: corré `yarn build` antes de `yarn test:e2e`.');
  }
});

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'arcli-e2e-'));
});

afterEach(() => {
  rmSync(configDir, { force: true, recursive: true });
});

describe('arcli compilado', () => {
  it('--version imprime la versión de package.json', () => {
    const result = run('--version');

    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout.trim()).toBe(VERSION);
  });

  it('--ayuda muestra la tabla de comprobantes, con las E', () => {
    const result = run('--ayuda');

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Comprobantes (atajo por familia y letra)');
    expect(result.stdout).toMatch(/nota-credito\s+nca\s+ncb\s+ncc\s+nce/);
  });

  it('cada atajo tiene su ayuda', () => {
    for (const shortcut of [...VOUCHER_SHORTCUTS, ...EXPORT_VOUCHER_KINDS.map((kind) => kind.shortcut)]) {
      const result = run(shortcut, '--ayuda');

      expect(result.code, shortcut).toBe(0);
      expect(result.stdout, shortcut).toContain(`Uso: arcli ${shortcut}`);
    }
  });

  it('arcli ejemplos termina bien', () => {
    const result = run('ejemplos');

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('arcli fc');
  });
});

describe('errores con --json', () => {
  it.each([
    [['noexiste', '--json'], 'comando desconocido `noexiste`'],
    [['fc', '--opcion-rara', '--json'], 'opción desconocida `--opcion-rara`'],
    [['fc', '--monto', 'abc', '--json'], '`--monto` "abc" no es válido'],
    [['config', 'establecer', 'cuit', '123', '--json'], 'El CUIT "123" no es válido'],
  ])('%j es INPUT_VALIDATION_ERROR: un solo JSON en stderr y exit 1', (args, message) => {
    const result = run(...args);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(json(result.stderr)).toMatchObject({ codigo: 'INPUT_VALIDATION_ERROR' });
    expect(json(result.stderr).error).toContain(message);
  });

  it('sin CUIT corta con CONFIGURATION_ERROR antes de ir a ARCA', () => {
    const result = run('fc', '-m', '1000', '--cs', '--cfinal', '--previsualizar', '--json');

    expect(result.code).toBe(1);
    expect(json(result.stderr)).toMatchObject({
      codigo: 'CONFIGURATION_ERROR',
      error: expect.stringContaining('CUIT'),
    });
  });

  it('un config.json roto es CONFIGURATION_ERROR con la ruta, y no se pisa', () => {
    const path = join(configDir, 'config.json');

    writeFileSync(path, '{roto');

    const result = run('config', '--json');

    expect(result.code).toBe(1);
    expect(json(result.stderr)).toMatchObject({ codigo: 'CONFIGURATION_ERROR', detalles: { ruta: path } });
    expect(readFileSync(path, 'utf8')).toBe('{roto');
  });
});

describe('config en ARCLI_CONFIG_DIR', () => {
  it('guarda en la carpeta indicada y la lee en la corrida siguiente', () => {
    expect(run('config', 'establecer', 'cuit', '20-40950976-3').code).toBe(0);
    expect(run('config', 'establecer', 'puntoVenta', '3').code).toBe(0);

    const result = run('config', '--json');

    expect(result.code).toBe(0);
    expect(json(result.stdout)).toMatchObject({ cuit: '20409509763', puntoVenta: 3 });
    expect(run('config', 'ruta').stdout.trim()).toBe(join(configDir, 'config.json'));
  });

  it('config revisar no es un error aunque falte todo: ok false y exit 0', () => {
    const result = run('config', 'revisar', '--json');

    expect(result.code).toBe(0);
    expect(json(result.stdout)).toMatchObject({ ok: false });
  });
});
