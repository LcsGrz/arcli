import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BACK } from '../../../modules/interactive/wizard';
import { BUNDLED_MONOTRIBUTO_TABLE } from '../../../modules/monotributo/monotributo.bundled';
import type { MonotributoReport } from '../../../modules/monotributo/monotributo.presenter';
import { plainText, useTerminal } from '../../../testing/terminal-layout';
import { loadMonotributoReport } from '../../monotributo-report';
import { runMonotributoQuery } from '../monotributo.flow';
import type { InteractiveSession } from '../session';

import { createScript } from './script';

/**
 * "Todas las columnas" en una terminal donde un bloque no entra (TUI-27): con el visor de verdad y las teclas por
 * stdin, como las aprieta la persona. CAT. queda fija y ←/→ corre la ventana de a una columna.
 */

let script = createScript([]);

vi.mock('../../monotributo-report', () => ({ loadMonotributoReport: vi.fn() }));
// Solo el menu va guionado; "Todas las columnas" usa el visor real.
vi.mock('../prompts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../prompts')>()),
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

const SESSION = {
  arca: {},
  runtime: { config: {}, environment: 'testing' },
} as unknown as InteractiveSession;

const terminal = useTerminal();
let output = '';

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * Espera a que el visor se dibuje: @inquirer difiere el primer dibujo y una maquina lenta (Windows en el CI) puede
 * tardar mas que un `tick`. Despues, cada tecla redibuja en el momento.
 */
async function untilPagerShows(): Promise<void> {
  for (let waited = 0; waited < 5000 && !plainText(output).includes('LÍMITES ANUALES'); waited += 20) {
    await tick();
  }
}

/**
 * Entra a "Todas las columnas", aprieta las teclas y devuelve lo que se vio: la pantalla del comienzo y la de despues
 * de cada tecla, sin color. Al final, Enter vuelve al menu y el guion sale.
 */
async function browse(keys: ReadonlyArray<'left' | 'right'>): Promise<string[]> {
  script = createScript([
    [/Y ahora/, 'Ver todas las columnas'],
    [/Y ahora/, BACK],
  ]);

  const run = runMonotributoQuery(SESSION);
  const frames: string[] = [];
  let mark = output.length;

  await untilPagerShows();

  for (const name of keys) {
    frames.push(plainText(output.slice(mark)));
    mark = output.length;
    process.stdin.emit('keypress', '', { name });
    await tick();
  }

  frames.push(plainText(output.slice(mark)));
  process.stdin.emit('keypress', '\r', { name: 'return' });
  await run;

  return frames;
}

/** Lo que dice el indicador de columnas de una pantalla. */
function windowOf(frame: string): { readonly first: number; readonly last: number; readonly total: number } | null {
  const match = frame.match(/columnas (\d+) a (\d+) de (\d+)/);

  return match ? { first: Number(match[1]), last: Number(match[2]), total: Number(match[3]) } : null;
}

/** La fila de la E en una pantalla: la letra y lo que la sigue en la misma línea. */
const ownRow = (frame: string) => frame.split('\n').find((line) => /^\s+❯ E\s/.test(line)) ?? '';

describe('"Todas las columnas" cuando un bloque no entra (TUI-27)', () => {
  beforeEach(() => {
    output = '';
    vi.mocked(loadMonotributoReport).mockResolvedValue(REPORT);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk);

      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(script.remaining()).toBe(0);
  });

  it('en 72 columnas arranca con CAT. y las primeras columnas de límites, en columnas y sin cortarse', async () => {
    terminal.set({ columns: 72 });

    const [first = ''] = await browse([]);
    const window = windowOf(first);

    expect(window).toMatchObject({ first: 1, total: 5 });
    expect(window?.last).toBeLessThan(5);
    expect(first).toMatch(new RegExp(`columnas 1 a ${window?.last} de 5  →`));
    expect(first).not.toMatch(/←\s+columnas/);
    expect(first).toMatch(/CAT\. +INGRESOS/);
    // La E en una sola línea, con su tope: no apilada.
    expect(ownRow(first)).toMatch(/❯ E +\$ 36\.028\.231,33/);
    expect(Math.max(...first.split('\n').map((line) => line.trimEnd().length))).toBeLessThanOrEqual(72);
    // La posición entre bloques sigue adentro, arriba.
    expect(first).toContain('1/2  cuota mensual →');
  });

  it('→ corre de a una columna, con la nueva pegada a la derecha; CAT. no se va', async () => {
    terminal.set({ columns: 72 });

    const frames = await browse(['right', 'right', 'right', 'right']);
    const windows = frames.map(windowOf);
    const start = windows[0];

    expect(start).not.toBeNull();

    // Mientras quedan columnas a la derecha: la ventana termina una más allá cada vez.
    for (let step = 1; step < windows.length && (windows[step - 1]?.last ?? 5) < 5; step += 1) {
      expect(windows[step]?.last).toBe((windows[step - 1]?.last ?? 0) + 1);
      expect(frames[step]).toMatch(/←\s+columnas/);
      expect(frames[step]).toMatch(/CAT\./);
      expect(ownRow(frames[step] ?? '')).toMatch(/❯ E +\S/);
    }

    const end = frames.find((frame) => windowOf(frame)?.last === 5) ?? '';

    expect(end).toMatch(/← {2}columnas \d+ a 5 de 5(?! *→)/);
    expect(end).toMatch(/PRECIO UNIT\./);
  });

  it('← vuelve de a una columna, con la nueva pegada a la izquierda', async () => {
    terminal.set({ columns: 72 });

    const frames = await browse(['right', 'right', 'left', 'left']);
    const windows = frames.map(windowOf);

    expect(windows[0]).not.toBeNull();
    expect(windows[2]?.last).toBeGreaterThan(windows[0]?.last ?? 0);
    expect(windows[3]?.first).toBe((windows[2]?.first ?? 0) - 1);
    expect(windows[4]?.first).toBe((windows[3]?.first ?? 0) - 1);
    expect(frames[4]).toMatch(/CAT\. +INGRESOS/);
  });

  it('en la cuota, la ventana va como en la propuesta: 1 a 4, 2 a 5 y 3 a 6 de 6', async () => {
    terminal.set({ columns: 72 });

    // Se recorren los límites hasta el final y → sigue a la cuota mensual.
    const frames = await browse(Array.from({ length: 9 }, () => 'right' as const));
    const fee = frames.filter((frame) => frame.includes('CUOTA MENSUAL EN PESOS'));

    expect(fee[0]).toMatch(/columnas 1 a 4 de 6 {2}→/);
    expect(fee[1]).toMatch(/← {2}columnas 2 a 5 de 6 {2}→/);
    expect(fee[2]).toMatch(/← {2}columnas 3 a 6 de 6(?! *→)/);
    expect(fee[2]).toMatch(/CAT\. +SIPA +OBRA SOCIAL +TOTAL SERV\. +TOTAL VENTAS/);
  });

  it('en 92 columnas todo entra: sin ventana ni indicador de columnas', async () => {
    terminal.set({ columns: 92 });

    const [first = ''] = await browse([]);

    expect(first).toMatch(/CAT\. +INGRESOS +SUPERFICIE +ENERGÍA +ALQUILERES +PRECIO UNIT\./);
    expect(windowOf(first)).toBeNull();
  });
});
