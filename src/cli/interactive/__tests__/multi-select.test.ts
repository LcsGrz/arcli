import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { BACK } from '../../../modules/interactive/wizard';
import { stripAnsi } from '../../../ui';
import { multiSelect } from '../multi-select';

const DOWN = '\u001B[B';
const ENTER = '\r';
const SPACE = ' ';

const THEME = {
  style: {
    description: (text: string) => text,
    keysHelpTip: (keys: Array<[string, string]>) => keys.map(([key]) => key).join(' '),
  },
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/** Corre el prompt de verdad: las teclas entran por `input` y lo dibujado sale por `output`. */
async function run(keys: readonly string[], selected: readonly string[] = []) {
  const input = new PassThrough();
  const output = new PassThrough();
  let screen = '';

  output.on('data', (chunk: Buffer) => {
    screen += chunk.toString();
  });

  const answer = multiSelect(
    {
      backLabel: '← Volver',
      choices: [
        { name: 'Moneda extranjera', value: 'moneda' },
        { name: 'Exento', value: 'exento' },
      ],
      message: '¿Agregamos algún opcional?',
      pageSize: 12,
      selected,
      theme: THEME,
    },
    { input, output },
  );

  for (const key of keys) {
    await tick();
    input.write(key);
  }

  return { answer: await answer, screen: stripAnsi(screen) };
}

describe('multiSelect', () => {
  it('muestra "Volver" como un boton, sin circulo, y el cursor separado del icono', async () => {
    const { screen } = await run([ENTER]);

    expect(screen).toContain('❯ ◯ Moneda extranjera');
    expect(screen).toContain('  ◯ Exento');
    expect(screen).toContain('  ← Volver');
    expect(screen).not.toMatch(/◯ ← Volver/);
  });

  it('Enter sobre "Volver" vuelve, aunque haya opciones marcadas', async () => {
    const { answer } = await run([SPACE, DOWN, DOWN, ENTER]);

    expect(answer).toBe(BACK);
  });

  it('espacio no marca "Volver"', async () => {
    const { answer, screen } = await run([DOWN, DOWN, SPACE, DOWN, ENTER]);

    expect(answer).toBe(BACK);
    expect(screen).not.toMatch(/◉ ← Volver/);
  });

  it('confirma lo marcado, en el orden de las opciones', async () => {
    const { answer } = await run([SPACE, ENTER], ['exento']);

    expect(answer).toEqual(['moneda', 'exento']);
  });

  it('`a` marca todas las opciones y deja afuera a "Volver"', async () => {
    const { answer, screen } = await run(['a', ENTER]);

    expect(answer).toEqual(['moneda', 'exento']);
    expect(screen).toContain('◉ Exento');
    expect(screen).not.toMatch(/◉ ← Volver/);
  });

  it('`i` invierte solo las opciones', async () => {
    const { answer } = await run(['i', ENTER], ['exento']);

    expect(answer).toEqual(['moneda']);
  });
});
