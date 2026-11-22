import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUNDLED_MONOTRIBUTO_TABLE } from '../../../modules/monotributo/monotributo.bundled';
import type { MonotributoReport } from '../../../modules/monotributo/monotributo.presenter';
import { stripAnsi } from '../../../ui';
import { loadMonotributoReport } from '../../monotributo-report';
import { registerMonotributoCommand } from '../monotributo.command';

const config = vi.hoisted(() => ({
  broken: false,
  value: { entornoPorDefecto: 'produccion', output: { jsonPorDefecto: false } } as Record<string, unknown>,
}));

vi.mock('../../../modules/config/config.service', () => ({
  ConfigService: class {
    public constructor() {
      if (config.broken) {
        throw new Error('config.json ilegible');
      }
    }
    public close() {}
    public getConfig() {
      return config.value;
    }
  },
}));

vi.mock('../../monotributo-report', () => ({ loadMonotributoReport: vi.fn() }));

const REPORT: MonotributoReport = {
  consultedOn: '20261118',
  notices: ['La tabla es de hace 40 días.'],
  ownCategory: 'E',
  source: 'arca',
  table: BUNDLED_MONOTRIBUTO_TABLE,
  version: '2.6.0',
};

async function run(argv: string[]): Promise<{ error?: unknown; stderr: string; stdout: string }> {
  const program = new Command().exitOverride();

  program.option('--json').option('--testing').option('--produccion');
  registerMonotributoCommand(program);

  try {
    await program.parseAsync(['node', 'arcli', ...argv]);

    return output();
  } catch (error) {
    return { ...output(), error };
  }
}

function output(): { stderr: string; stdout: string } {
  const join = (stream: NodeJS.WriteStream) =>
    stripAnsi(
      vi
        .mocked(stream.write)
        .mock.calls.map(([chunk]) => String(chunk))
        .join(''),
    );

  return { stderr: join(process.stderr), stdout: join(process.stdout) };
}

describe('arcli monotributo', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.mocked(loadMonotributoReport).mockResolvedValue(REPORT);
  });

  afterEach(() => {
    config.broken = false;
    config.value = { entornoPorDefecto: 'produccion', output: { jsonPorDefecto: false } };
    vi.restoreAllMocks();
    vi.mocked(loadMonotributoReport).mockReset();
  });

  it('sin flags: el resumen en texto, con los avisos en stderr, y el entorno de la config', async () => {
    const { stderr, stdout } = await run(['monotributo']);

    expect(stderr).toContain('La tabla es de hace 40 días.');
    expect(stdout).not.toContain('La tabla es de hace 40 días.');
    expect(stdout).toContain('CATEGORÍAS DEL MONOTRIBUTO');
    expect(stdout).toContain('tu categoría');
    expect(loadMonotributoReport).toHaveBeenCalledWith(
      expect.objectContaining({ environment: 'produccion', quiet: false, refresh: false }),
    );
  });

  it('--json: el JSON, sin spinner ni avisos en stderr', async () => {
    const { stderr, stdout } = await run(['monotributo', '--json', '--actualizar']);

    expect(JSON.parse(stdout)).toMatchObject({ avisos: ['La tabla es de hace 40 días.'], tuCategoria: 'E' });
    expect(stderr).toBe('');
    expect(loadMonotributoReport).toHaveBeenCalledWith(expect.objectContaining({ quiet: true, refresh: true }));
  });

  it('--categoria muestra esa en texto y en JSON trae solo esa', async () => {
    expect((await run(['monotributo', '--categoria', 'k'])).stdout).toMatch(/Categoría K/i);

    vi.mocked(process.stdout.write).mockClear();

    const json = JSON.parse((await run(['monotributo', '--categoria', 'K', '--json'])).stdout);

    expect(json.categorias.map((category: { categoria: string }) => category.categoria)).toEqual(['K']);
  });

  it('--completa muestra todas las columnas', async () => {
    const { stdout } = await run(['monotributo', '--completa']);

    expect(stdout).toMatch(/Cuota/i);
    expect(stdout).toMatch(/\bK\b/);
  });

  it('--categoria y --completa juntos no valen, como una letra fuera de la A a la K', async () => {
    expect((await run(['monotributo', '--categoria', 'a', '--completa'])).error).toMatchObject({
      code: 'INPUT_VALIDATION_ERROR',
      message: 'Usá `--categoria` o `--completa`, no los dos.',
    });
    expect((await run(['monotributo', '--categoria', 'z'])).error).toMatchObject({
      message: expect.stringContaining('`--categoria` "z" no es válido'),
    });
    expect(loadMonotributoReport).not.toHaveBeenCalled();
  });

  it('--testing y --produccion eligen el entorno; los dos juntos no valen', async () => {
    await run(['monotributo', '--testing']);
    expect(loadMonotributoReport).toHaveBeenLastCalledWith(expect.objectContaining({ environment: 'testing' }));

    config.value = { entornoPorDefecto: 'testing', output: { jsonPorDefecto: false } };
    await run(['monotributo', '--produccion']);
    expect(loadMonotributoReport).toHaveBeenLastCalledWith(expect.objectContaining({ environment: 'produccion' }));

    expect((await run(['monotributo', '--testing', '--produccion'])).error).toMatchObject({
      message: 'Usá `--testing` o `--produccion`, pero no ambos a la vez.',
    });
  });

  it('con la config ilegible muestra la tabla igual, en testing y sin categoría propia de la config', async () => {
    config.broken = true;

    const { error, stdout } = await run(['monotributo']);

    expect(error).toBeUndefined();
    expect(stdout).not.toBe('');
    expect(loadMonotributoReport).toHaveBeenCalledWith(
      expect.objectContaining({ config: undefined, environment: 'testing' }),
    );
  });
});
