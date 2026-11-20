import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BACK } from '../../../modules/interactive/wizard';
import { stripAnsi } from '../../../ui';
import { rowActionsList } from '../row-actions-list';

const DOWN = '\u001B[B';
const UP = '\u001B[A';
const ENTER = '\r';
const SPACE = ' ';
const BACKSPACE = '\u007F';

const THEME = {
  style: {
    keysHelpTip: (keys: Array<[string, string]>) => keys.map(([key, action]) => `${key} ${action}`).join(' · '),
  },
};

const ROWS = [
  { detail: '1.000 litros x 1,50 USD', title: 'Jugo', total: '1.500 USD' },
  { detail: '1 unidades x 500 USD', title: 'Flete', total: '500 USD' },
];

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/** Corre el prompt de verdad: las teclas entran por `input` y lo dibujado sale por `output`. */
async function run(keys: readonly string[], rows = ROWS, width = 80) {
  const input = new PassThrough();
  const output = new PassThrough();
  let screen = '';

  output.on('data', (chunk: Buffer) => {
    screen += chunk.toString();
  });

  const answer = rowActionsList(
    {
      addLabel: '+ Agregar ítem',
      backLabel: '← Volver',
      message: '¿Qué ítems cambiamos?',
      minRows: 1,
      minRowsNotice: 'Queda al menos un ítem.',
      pageSize: 12,
      rows,
      theme: THEME,
      width,
    },
    { input, output },
  );

  for (const key of keys) {
    await tick();
    input.write(key);
  }

  return { answer: await answer, screen: stripAnsi(screen) };
}

describe('rowActionsList (NAV-10)', () => {
  beforeEach(() => {
    vi.stubEnv('NO_COLOR', '1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('Enter sin marcas no cambia nada', async () => {
    const { answer, screen } = await run([ENTER]);

    expect(answer).toEqual({ add: false, edit: [], remove: [] });
    expect(screen).toContain('❯ ◯ Jugo');
    expect(screen).toContain('  ◯ + Agregar ítem');
    expect(screen).toContain('  ← Volver');
    expect(screen).toContain('espacio modificar · ⌫ borrar · ⏎ aplicar');
  });

  it('espacio marca para modificar y otro espacio desmarca', async () => {
    expect((await run([SPACE, DOWN, SPACE, ENTER])).answer).toEqual({ add: false, edit: [0, 1], remove: [] });
    expect((await run([SPACE, SPACE, ENTER])).answer).toEqual({ add: false, edit: [], remove: [] });
  });

  it('Backspace marca para borrar con el punto, y otro Backspace desmarca', async () => {
    const marked = await run([DOWN, BACKSPACE, ENTER]);

    expect(marked.answer).toEqual({ add: false, edit: [], remove: [1] });
    expect(marked.screen).toContain('● Flete');
    expect(marked.screen).toContain('1 para borrar');
    expect((await run([DOWN, BACKSPACE, BACKSPACE, ENTER])).answer).toEqual({ add: false, edit: [], remove: [] });
  });

  it('una fila es o para modificar o para borrar: la última tecla gana', async () => {
    expect((await run([SPACE, BACKSPACE, ENTER])).answer).toEqual({ add: false, edit: [], remove: [0] });
    expect((await run([BACKSPACE, SPACE, ENTER])).answer).toEqual({ add: false, edit: [0], remove: [] });
  });

  it('no deja borrar el último ítem, y lo explica', async () => {
    const last = await run([BACKSPACE, DOWN, BACKSPACE, ENTER]);

    expect(last.answer).toEqual({ add: false, edit: [], remove: [0] });
    expect(last.screen).toContain('Queda al menos un ítem.');

    const single = await run([BACKSPACE, ENTER], [ROWS[0]!]);

    expect(single.answer).toEqual({ add: false, edit: [], remove: [] });
    expect(single.screen).toContain('Queda al menos un ítem.');
  });

  it('el aviso se va con la tecla siguiente', async () => {
    const { screen } = await run([BACKSPACE, DOWN, BACKSPACE, UP, ENTER]);
    const afterNotice = screen.slice(screen.lastIndexOf('Queda al menos un ítem.') + 1);

    expect(afterNotice).toContain('❯ ● Jugo');
    expect(afterNotice).not.toContain('Queda al menos un ítem.');
  });

  it('"Agregar ítem": con espacio se marca junto con lo demás, y Enter sobre la fila también agrega', async () => {
    expect((await run([SPACE, DOWN, DOWN, SPACE, UP, ENTER])).answer).toEqual({ add: true, edit: [0], remove: [] });
    expect((await run([DOWN, DOWN, ENTER])).answer).toEqual({ add: true, edit: [], remove: [] });
    // Backspace sobre "Agregar ítem" no hace nada.
    expect((await run([DOWN, DOWN, BACKSPACE, UP, ENTER])).answer).toEqual({ add: false, edit: [], remove: [] });
  });

  it('Enter sobre "Volver" vuelve, aunque haya marcas', async () => {
    expect((await run([SPACE, DOWN, DOWN, DOWN, ENTER])).answer).toBe(BACK);
    // No pasa de "Volver" ni de la primera fila.
    expect((await run([UP, DOWN, DOWN, DOWN, DOWN, ENTER])).answer).toBe(BACK);
  });

  it('se ve bien en 40 columnas: ninguna línea se pasa', async () => {
    const long = [
      { detail: '1.000 litros x 1,50 USD', title: 'Jugo de naranja concentrado sin azúcar', total: '1.500 USD' },
    ];
    const { screen } = await run([ENTER], long, 40);
    const drawn = screen.split('\n').filter((line) => line.includes('Jugo'));

    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((line) => line.replace(/\s+$/, '').length <= 40)).toBe(true);
  });
});
