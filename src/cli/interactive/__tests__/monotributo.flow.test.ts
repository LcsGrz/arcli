import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BACK } from '../../../modules/interactive/wizard';
import { BUNDLED_MONOTRIBUTO_TABLE } from '../../../modules/monotributo/monotributo.bundled';
import type { MonotributoReport } from '../../../modules/monotributo/monotributo.presenter';
import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import { stripAnsi } from '../../../ui';
import { loadMonotributoReport } from '../../monotributo-report';
import { runMonotributoQuery } from '../monotributo.flow';
import type { InteractiveSession } from '../session';

import { createScript } from './script';

let script = createScript([]);

vi.mock('../../monotributo-report', () => ({ loadMonotributoReport: vi.fn() }));

/** Lo que dibujo "Ver todas las columnas": cada bloque, como lo veria la persona al moverse con ←/→. */
const browsed: string[][] = [];

vi.mock('../prompts', () => ({
  browseBlocks: async <B extends string>(
    _message: string,
    blocks: readonly B[],
    render: (block: B) => string,
    keys: ReadonlyArray<readonly [string, string]>,
  ) => {
    browsed.push([
      ...blocks.map((block) => render(block)),
      keys.map(([key, action]) => `${key} ${action}`).join(' · '),
    ]);
  },
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
}));

const REPORT: MonotributoReport = {
  consultedOn: '20261118',
  notices: [],
  ownCategory: 'E',
  source: 'arca',
  table: BUNDLED_MONOTRIBUTO_TABLE,
  version: '2.6.0',
};

function createSession(): InteractiveSession {
  return {
    arca: {} as never,
    billingGateway: { createVoucher: vi.fn(), getNextVoucherNumber: vi.fn(), getQuotation: vi.fn() },
    historyGateway: { getLastNumber: vi.fn(), getVoucher: vi.fn() },
    runtime: {
      config: { cert: {}, cuit: '20333333334', entornoPorDefecto: 'testing', key: {}, output: {} },
      environment: 'testing',
    } as unknown as ResolvedArcaRuntime,
    service: {} as never,
  };
}

let output = '';

describe('Categorías del monotributo', () => {
  beforeEach(() => {
    output = '';
    browsed.length = 0;
    vi.mocked(loadMonotributoReport).mockResolvedValue(REPORT);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk);

      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(loadMonotributoReport).mockReset();
    expect(script.remaining()).toBe(0);
  });

  it('muestra la tabla sin sugerencias de comandos y vuelve con ← Volver', async () => {
    script = createScript([[/Y ahora/, BACK]]);

    await runMonotributoQuery(createSession());

    const text = stripAnsi(output);

    expect(text).toContain('CATEGORÍAS DEL MONOTRIBUTO · DESDE EL 01/08/2026');
    expect(text).toContain('tu categoría');
    expect(text).not.toContain('arcli monotributo --completa');
    expect(loadMonotributoReport).toHaveBeenCalledWith(expect.objectContaining({ refresh: false }));
  });

  it('los avisos van arriba de la tabla', async () => {
    vi.mocked(loadMonotributoReport).mockResolvedValue({ ...REPORT, notices: ['La tabla puede estar vieja.'] });
    script = createScript([[/Y ahora/, BACK]]);

    await runMonotributoQuery(createSession());

    const text = stripAnsi(output);

    expect(text.indexOf('AVISOS')).toBeLessThan(text.indexOf('CATEGORÍAS DEL MONOTRIBUTO'));
  });

  it('"Ver una categoría completa" arranca en la propia y muestra la ficha', async () => {
    script = createScript([
      [/Y ahora/, 'Ver una categoría completa'],
      [/Qué categoría/, 'K ·'],
      [/Y ahora/, BACK],
    ]);

    await runMonotributoQuery(createSession());

    const [, choices, defaultValue] = script.chooseStep.mock.calls[1] ?? [];

    expect(defaultValue).toBe('E');
    expect((choices as ReadonlyArray<{ readonly name: string }> | undefined)?.[4]?.name).toContain(
      'E · hasta $ 36.028.231,33 (tu categoría)',
    );
    expect(stripAnsi(output)).toContain('CATEGORÍA K DEL MONOTRIBUTO');
    expect(stripAnsi(output)).toContain('Es la categoría más alta.');
  });

  it('"Ver todas las columnas" pasa entre límites y cuota con ←/→', async () => {
    script = createScript([
      [/Y ahora/, 'Ver todas las columnas'],
      [/Y ahora/, BACK],
    ]);

    await runMonotributoQuery(createSession());

    const [limits, fee, help] = (browsed[0] ?? []).map((text) => stripAnsi(text));

    expect(limits).toContain('1/2  cuota mensual →');
    expect(limits).toContain('LÍMITES ANUALES');
    expect(fee).toContain('← límites anuales  2/2');
    expect(fee).toContain('CUOTA MENSUAL EN PESOS');
    expect(help).toBe('←→ cambiar de bloque · ⏎ volver al menú');
  });

  it('"Actualizar desde ARCA" vuelve a leer la tabla y la muestra', async () => {
    script = createScript([
      [/Y ahora/, 'Actualizar desde ARCA'],
      [/Y ahora/, BACK],
    ]);

    await runMonotributoQuery(createSession());

    expect(loadMonotributoReport).toHaveBeenLastCalledWith(expect.objectContaining({ refresh: true }));
    expect(stripAnsi(output).split('CATEGORÍAS DEL MONOTRIBUTO')).toHaveLength(3);
  });
});
