import { Separator } from '@inquirer/core';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { currencyChoices } from '../../../modules/interactive/choices';
import { BACK } from '../../../modules/interactive/wizard';
import { scrollWindow, stripAnsi } from '../../../ui';
import { listSelect, type ListSelectChoice } from '../list-select';

const DOWN = '\u001B[B';
const UP = '\u001B[A';
const ENTER = '\r';

const THEME = {
  style: {
    description: (text: string) => text,
    keysHelpTip: (keys: Array<[string, string]>) => keys.map(([key]) => key).join(' '),
  },
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

const MANY: ReadonlyArray<ListSelectChoice<number>> = Array.from({ length: 20 }, (_, index) => ({
  name: `Opción ${index + 1}`,
  value: index + 1,
}));

/**
 * Corre el prompt de verdad: las teclas entran por `input` y lo dibujado sale por `output`. Devuelve la respuesta y
 * cada pantalla, sin colores: la primera y la que queda despues de cada tecla.
 */
async function run(
  keys: readonly string[],
  options: {
    readonly choices?: ReadonlyArray<ListSelectChoice<number> | Separator>;
    readonly default?: number | typeof BACK;
    readonly pageSize?: number;
  } = {},
) {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames: string[] = [];
  let pending = '';

  output.on('data', (chunk: Buffer) => {
    pending += chunk.toString();
  });

  const answer = listSelect<number, typeof BACK>(
    {
      back: { label: '← Volver', value: BACK },
      choices: options.choices ?? MANY,
      default: options.default,
      message: '¿Cuál?',
      pageSize: options.pageSize ?? 5,
      theme: THEME,
    },
    { input, output },
  );

  for (const key of keys) {
    await tick();
    frames.push(stripAnsi(pending));
    pending = '';
    input.write(key);
  }

  return { answer: await answer, frames };
}

/** Las lineas de una pantalla, sin el espacio del final de cada una. */
function lines(frame: string | undefined): string[] {
  return (frame ?? '').split('\n').map((line) => line.trimEnd());
}

describe('scrollWindow', () => {
  it('deja la marcada en el medio y se pega a los bordes', () => {
    expect(scrollWindow(3, 0, 5)).toEqual({ end: 3, scrolls: false, start: 0 });
    expect(scrollWindow(20, 0, 5)).toEqual({ end: 5, scrolls: true, start: 0 });
    expect(scrollWindow(20, 10, 5)).toEqual({ end: 13, scrolls: true, start: 8 });
    expect(scrollWindow(20, 19, 5)).toEqual({ end: 20, scrolls: true, start: 15 });
  });
});

describe('listSelect', () => {
  it('si todo entra, no avisa nada y "Volver" va debajo, separado por una linea', async () => {
    const choices = MANY.slice(0, 3);
    const { frames } = await run([ENTER], { choices });

    expect(lines(frames[0]).slice(1, 6)).toEqual(['❯ Opción 1', '  Opción 2', '  Opción 3', '', '  ← Volver']);
    expect(frames[0]).not.toContain('más');
  });

  it('al principio avisa las de abajo y "Volver" queda fijo debajo de la lista', async () => {
    const { frames } = await run([ENTER]);

    expect(lines(frames[0]).slice(1, 10)).toEqual([
      '',
      '❯ Opción 1',
      '  Opción 2',
      '  Opción 3',
      '  Opción 4',
      '  Opción 5',
      '  ↓ 15 más',
      '',
      '  ← Volver',
    ]);
  });

  it('en el medio avisa las de arriba y las de abajo, y "Volver" sigue a la vista', async () => {
    const { answer, frames } = await run([...Array.from({ length: 10 }, () => DOWN), ENTER]);

    expect(answer).toBe(11);
    expect(lines(frames.at(-1)).slice(1, 10)).toEqual([
      '  ↑ 8 más',
      '  Opción 9',
      '  Opción 10',
      '❯ Opción 11',
      '  Opción 12',
      '  Opción 13',
      '  ↓ 7 más',
      '',
      '  ← Volver',
    ]);
  });

  it('bajando desde la ultima opcion se llega a "Volver", y subiendo se vuelve a la ultima', async () => {
    const toBack = Array.from({ length: 20 }, () => DOWN);
    const { answer, frames } = await run([...toBack, ENTER]);
    const { answer: last } = await run([...toBack, UP, ENTER]);

    expect(answer).toBe(BACK);
    expect(lines(frames.at(-1)).slice(1, 10)).toEqual([
      '  ↑ 15 más',
      '  Opción 16',
      '  Opción 17',
      '  Opción 18',
      '  Opción 19',
      '  Opción 20',
      '',
      '',
      '❯ ← Volver',
    ]);
    expect(last).toBe(20);
  });

  it('arranca en la opcion por defecto, con la pagina alrededor', async () => {
    const { answer, frames } = await run([ENTER], { default: 15 });

    expect(answer).toBe(15);
    expect(frames[0]).toContain('↑ 12 más');
    expect(frames[0]).toContain('❯ Opción 15');
  });

  it('una opcion por defecto que no esta (una respuesta vieja) arranca en la primera', async () => {
    const { answer, frames } = await run([ENTER], { default: 99 });

    expect(answer).toBe(1);
    expect(frames[0]).toContain('❯ Opción 1');
  });

  it('saltea los separadores, no deja elegir las apagadas y muestra la descripcion de la marcada', async () => {
    const choices = [
      { description: 'La primera', name: 'Uno', value: 1 },
      new Separator(' '),
      { disabled: '(sin datos)', name: 'Dos', value: 2 },
      { name: 'Tres', value: 3 },
    ];
    const { answer, frames } = await run([DOWN, ENTER, DOWN, ENTER], { choices });

    expect(frames[0]).toContain('La primera');
    expect(frames[1]).toContain('❯ Dos (sin datos)');
    expect(answer).toBe(3);
  });

  it('escribir el principio de una opcion la marca', async () => {
    const { answer } = await run(['O', 'p', 'c', 'i', 'ó', 'n', ' ', '7', ENTER]);

    expect(answer).toBe(7);
  });

  it('en el aviso no cuenta los separadores', async () => {
    const choices = [...MANY.slice(0, 5), new Separator(' '), ...MANY.slice(5, 8)];
    const { frames } = await run([ENTER], { choices });

    expect(frames[0]).toContain('↓ 3 más');
  });
});

/** Una pausa entre teclas, mas larga que la de @inquirer/select (700 ms), que borraba lo escrito. */
const PAUSE = { pauseMs: 800 } as const;

/** Como `run`, con la lista de monedas del asistente y pausas entre teclas. */
async function runCurrencies(keys: ReadonlyArray<string | typeof PAUSE>) {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames: string[] = [];
  let pending = '';

  output.on('data', (chunk: Buffer) => {
    pending += chunk.toString();
  });

  const answer = listSelect<string, typeof BACK>(
    {
      back: { label: '← Volver', value: BACK },
      choices: currencyChoices(),
      message: 'Moneda del comprobante:',
      pageSize: 12,
      theme: THEME,
    },
    { input, output },
  );

  for (const key of keys) {
    if (typeof key !== 'string') {
      await new Promise((resolve) => setTimeout(resolve, key.pauseMs));
      continue;
    }

    await tick();
    frames.push(stripAnsi(pending));
    pending = '';
    input.write(key);
  }

  return { answer: await answer, frames };
}

/** Teclas, una por letra. */
const typed = (text: string) => [...text];

describe('listSelect: buscar escribiendo (TUI-17)', () => {
  it('"dolar" encuentra los dólares, sin tilde ni mayúscula', async () => {
    expect((await runCurrencies([...typed('dolar'), ENTER])).answer).toBe('USD');
    expect((await runCurrencies([...typed('DOLARES AU'), ENTER])).answer).toBe('AUD');
  });

  it('busca por ISO y por el código de ARCA', async () => {
    expect((await runCurrencies([...typed('usd'), ENTER])).answer).toBe('USD');
    expect((await runCurrencies([...typed('eur'), ENTER])).answer).toBe('EUR');
    expect((await runCurrencies([...typed('DOL'), ENTER])).answer).toBe('USD');
    expect((await runCurrencies([...typed('060'), ENTER])).answer).toBe('EUR');
  });

  it('busca por palabras, en cualquier orden', async () => {
    expect((await runCurrencies([...typed('canad dol'), ENTER])).answer).toBe('CAD');
  });

  it('muestra lo escrito, deja solo las que coinciden y no lo borra con el tiempo', async () => {
    const { answer, frames } = await runCurrencies([...typed('dol'), PAUSE, ...typed('ares can'), PAUSE, ENTER]);
    const last = frames.at(-1) ?? '';

    expect(answer).toBe('CAD');
    expect(last).toContain('Filtrar: dolares can');
    expect(last).toContain('❯ Dólares canadienses (CAD)');
    expect(last).not.toContain('Euros');
    expect(last).toContain('1 de ');
  });

  it('las flechas recorren solo las que coinciden, sin borrar lo escrito', async () => {
    const { answer, frames } = await runCurrencies([...typed('dolares'), DOWN, ENTER]);

    expect(frames.at(-1)).toContain('Filtrar: dolares');
    expect(answer).toBe('CAD');
  });

  it('Backspace borra la última letra y vuelve a filtrar', async () => {
    const { answer } = await runCurrencies([...typed('cnyx'), '\u007F', ENTER]);

    expect(answer).toBe('CNY');
  });

  it('si nada coincide lo dice, y Enter no elige nada', async () => {
    const { answer, frames } = await runCurrencies([...typed('zzz'), ENTER, '\u007F', '\u007F', '\u007F', ENTER]);

    const empty = frames.find((frame) => frame.includes('Nada coincide con "zzz".'));

    expect(empty).toBeDefined();
    expect(empty).not.toContain(' de ');
    expect(answer).toBe('PES');
  });
});
