import { Separator } from '@inquirer/core';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { currencyChoices } from '../../../modules/interactive/choices';
import { BACK } from '../../../modules/interactive/wizard';
import { stripAnsi } from '../../../ui';
import { listSelect, type ListSelectChoice, PinnedSeparator } from '../list-select';

/**
 * Buscar escribiendo en `listSelect` (TUI-17): la misma busqueda que `filterList` (sin tildes, por palabras y por
 * `keywords`), con lo escrito a la vista y sin borrarse solo.
 */

const DOWN = '\u001B[B';
const ENTER = '\r';
const BACKSPACE = '\u007F';
/** Ctrl+U: borra todo lo escrito de una vez. */
const CLEAR_LINE = '\u0015';

const THEME = {
  style: {
    description: (text: string) => text,
    keysHelpTip: (keys: Array<[string, string]>) => keys.map(([key]) => key).join(' '),
  },
};

/** Una pausa entre teclas, mas larga que la de @inquirer/select (700 ms), que borraba lo escrito. */
const PAUSE = { pauseMs: 800 } as const;

/** Monedas en un orden fijo, para no depender del de la tabla de ARCA. */
const CURRENCIES: ReadonlyArray<ListSelectChoice<string>> = [
  { keywords: 'PES ARS', name: 'Pesos', value: 'PES' },
  { keywords: 'DOL USD', name: 'Dólares estadounidenses (USD)', value: 'USD' },
  { keywords: '060 EUR', name: 'Euros (EUR)', value: 'EUR' },
  { keywords: '018 CAD', name: 'Dólares canadienses (CAD)', value: 'CAD' },
];

const MANY: ReadonlyArray<ListSelectChoice<string>> = Array.from({ length: 20 }, (_, index) => ({
  name: `Opción ${index + 1}`,
  value: String(index + 1),
}));

interface ListOptions {
  readonly choices?: ReadonlyArray<ListSelectChoice<string> | Separator>;
  readonly default?: string | typeof BACK;
  readonly filter?: boolean;
  readonly initialTerm?: string;
  readonly onChange?: (state: { readonly term: string; readonly value: unknown }) => void;
  readonly pageSize?: number;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/**
 * Corre la lista de verdad con las teclas y pausas dadas, sin esperar la respuesta. `frames`: la pantalla antes de
 * cada tecla y la de despues de la ultima. Por defecto, con la lista de monedas del asistente.
 */
async function press(keys: ReadonlyArray<string | typeof PAUSE>, options: ListOptions = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames: string[] = [];
  let pending = '';
  let answered = false;

  output.on('data', (chunk: Buffer) => {
    pending += chunk.toString();
  });

  const answer = listSelect<string, typeof BACK>(
    {
      back: { label: '← Volver', value: BACK },
      choices: options.choices ?? currencyChoices(),
      default: options.default,
      filter: options.filter,
      initialTerm: options.initialTerm,
      message: 'Moneda del comprobante:',
      onChange: options.onChange,
      pageSize: options.pageSize ?? 12,
      theme: THEME,
    },
    { input, output },
  );

  answer.then(
    () => {
      answered = true;
    },
    () => undefined,
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

  await tick();
  frames.push(stripAnsi(pending));

  return {
    answer,
    answered: () => answered,
    frames,
    last: frames.findLast((frame) => frame.includes('Moneda del comprobante')) ?? '',
  };
}

/** Como `press`, esperando la respuesta. */
async function choose(keys: ReadonlyArray<string | typeof PAUSE>, options: ListOptions = {}) {
  const { answer, frames } = await press(keys, options);

  return { answer: await answer, frames };
}

/** Teclas, una por letra. */
const typed = (text: string) => [...text];

/** Las lineas de las opciones en una pantalla. */
const optionLines = (frame: string, label: string) => frame.split('\n').filter((line) => line.includes(label));

describe('listSelect: buscar escribiendo', () => {
  it('"dolar" encuentra los dólares, sin tilde ni mayúscula', async () => {
    expect((await choose([...typed('dolar'), ENTER])).answer).toBe('USD');
    expect((await choose([...typed('DOLARES AU'), ENTER])).answer).toBe('AUD');
  });

  it('busca por ISO y por el código de ARCA', async () => {
    expect((await choose([...typed('usd'), ENTER])).answer).toBe('USD');
    expect((await choose([...typed('eur'), ENTER])).answer).toBe('EUR');
    expect((await choose([...typed('DOL'), ENTER])).answer).toBe('USD');
    expect((await choose([...typed('060'), ENTER])).answer).toBe('EUR');
  });

  it('busca por palabras, en cualquier orden', async () => {
    expect((await choose([...typed('canad dol'), ENTER])).answer).toBe('CAD');
  });

  it('muestra lo escrito, deja solo las que coinciden y no lo borra con el tiempo', async () => {
    const { answer, frames } = await choose([...typed('dol'), PAUSE, ...typed('ares can'), PAUSE, ENTER]);
    const last = frames.at(-2) ?? '';

    expect(answer).toBe('CAD');
    expect(last).toContain('Filtrar: dolares can');
    expect(last).toContain('❯ Dólares canadienses (CAD)');
    expect(last).not.toContain('Euros');
    expect(last).toContain('1 de ');
  });

  it('las flechas recorren solo las que coinciden, sin borrar lo escrito', async () => {
    const { answer, frames } = await choose([...typed('dolares'), DOWN, ENTER], { choices: CURRENCIES });

    expect(frames.at(-2)).toContain('Filtrar: dolares');
    expect(answer).toBe('CAD');
  });

  it('Backspace borra la última letra y vuelve a filtrar', async () => {
    expect((await choose([...typed('cnyx'), BACKSPACE, ENTER])).answer).toBe('CNY');
  });

  it('si nada coincide lo dice, sin "0 de"', async () => {
    const { last } = await press(typed('zzz'), { choices: CURRENCIES });

    expect(last).toContain('Nada coincide con "zzz".');
    expect(last).not.toContain(' de ');
  });

  it('Enter sin nada que elegir no borra lo escrito: Backspace sigue borrando de a una letra', async () => {
    const { answered, last } = await press([...typed('zzz'), ENTER, BACKSPACE, ENTER], { choices: CURRENCIES });

    expect(answered()).toBe(false);
    expect(last).toContain('Filtrar: zz');
    expect(last).toContain('Nada coincide con "zz".');
  });

  it('Enter sobre una apagada tampoco borra lo escrito', async () => {
    const choices = [{ disabled: '(sin datos)', name: 'Uno apagado', value: 'uno' }, ...CURRENCIES];
    const { answered, last } = await press([...typed('apagado'), ENTER, BACKSPACE], { choices });

    expect(answered()).toBe(false);
    expect(last).toContain('Filtrar: apagad');
  });

  it('un nombre con color se busca por su texto, no por los códigos de color', async () => {
    const choices = [
      { name: 'Alfa \u001B[31m(nuevo)\u001B[39m', value: 'alfa' },
      { name: 'Beta', value: 'beta' },
    ];

    // "31m" esta en los codigos de color de Alfa, no en su texto.
    expect((await press(typed('31m'), { choices })).last).toContain('Nada coincide con "31m".');
    expect((await choose([...typed('nuevo'), ENTER], { choices })).answer).toBe('alfa');
  });

  it('una lista que entra entera no se desplaza al filtrar', async () => {
    const { last } = await press(typed('op'), { choices: MANY.slice(0, 5), pageSize: 5 });

    expect(last).toContain('Filtrar: op');
    expect(last).not.toContain('más');
  });

  it('una que se desplaza: lo filtrado entra entero si cabe con las líneas del filtro; si no, la página se achica', async () => {
    // 20 opciones en 5 filas ocupan 7 lineas con los avisos. "Opción 1" deja 11: con las 3 del filtro no entran.
    const many = await press(typed('opcion 1'), { choices: MANY, pageSize: 5 });

    expect(optionLines(many.last, 'Opción')).toHaveLength(2);
    expect(many.last).toContain('↓ 9 más');
    expect(many.last).toContain('11 de 20');

    // De 12 opciones, "Opción 1" deja 4 (1, 10, 11 y 12): entran con las 3 del filtro, sin desplazarse.
    const few = await press(typed('opcion 1'), { choices: MANY.slice(0, 12), pageSize: 5 });

    expect(optionLines(few.last, 'Opción')).toHaveLength(4);
    expect(few.last).not.toContain('más');
  });

  it('un espacio no mueve la marcada', async () => {
    expect((await choose([...typed('dolares'), DOWN, ' ', ENTER], { choices: CURRENCIES })).answer).toBe('CAD');
  });

  it('borrar lo escrito con "Volver" marcado lo deja marcado', async () => {
    // Con "dol" quedan USD y CAD: dos flechas abajo llegan a "Volver".
    const { answer } = await choose([...typed('dol'), DOWN, DOWN, CLEAR_LINE, ENTER], { choices: CURRENCIES });

    expect(answer).toBe(BACK);
  });

  it('arranca con lo escrito y la marcada que se le pasan, y avisa cada cambio', async () => {
    const changes: unknown[] = [];
    const { answer, frames } = await choose([DOWN, ENTER], {
      choices: CURRENCIES,
      default: 'USD',
      initialTerm: 'dol',
      onChange: (state) => changes.push(state),
    });

    expect(frames[0]).toContain('Filtrar: dol');
    expect(frames[0]).toContain('❯ Dólares estadounidenses (USD)');
    expect(answer).toBe('CAD');
    expect(changes).toEqual([{ term: 'dol', value: 'CAD' }]);
  });

  it('lo escrito al arrancar se sigue editando', async () => {
    const keys = [BACKSPACE, BACKSPACE, BACKSPACE, ...typed('eur'), ENTER];

    expect((await choose(keys, { choices: CURRENCIES, initialTerm: 'dol' })).answer).toBe('EUR');
  });

  it('un separador fijo ("Cargando…") se sigue viendo mientras se filtra', async () => {
    const choices = [...CURRENCIES, new Separator(' '), new PinnedSeparator('Cargando…')];
    const { last } = await press(typed('zzz'), { choices });

    expect(last).toContain('Cargando…');
    expect(last).toContain('Nada coincide con "zzz".');
  });

  it('con `filter: false` escribir no hace nada y Enter elige la marcada', async () => {
    const { answer, frames } = await choose([...typed('e'), ENTER], { choices: CURRENCIES, filter: false });

    expect(answer).toBe('PES');
    expect(frames.join('')).not.toContain('Filtrar:');
  });
});
