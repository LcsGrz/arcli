import { Separator } from '@inquirer/core';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { BACK } from '../../../modules/interactive/wizard';
import { stripAnsi } from '../../../ui';
import { blockPager } from '../block-pager';
import { listSelect, type ListSelectChoice } from '../list-select';
import { multiSelect } from '../multi-select';

/**
 * Los prompts propios, de verdad: las teclas entran por un stream y lo dibujado sale por otro. Casos que una persona
 * dispara sin querer: teclas en los bordes, listas vacias, opciones apagadas, borrar lo escrito.
 */

const LEFT = '\u001B[D';
const RIGHT = '\u001B[C';
const UP = '\u001B[A';
const DOWN = '\u001B[B';
const ENTER = '\r';
const BACKSPACE = '\u007F';
const SPACE = ' ';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

const THEME = {
  style: {
    description: (text: string) => text,
    keysHelpTip: (keys: Array<[string, string]>) => keys.map(([key]) => key).join(' '),
  },
};

/** Corre `start` con streams propios, manda las teclas y devuelve la respuesta y la ultima pantalla. */
async function drive<A>(
  start: (context: { input: PassThrough; output: PassThrough }) => Promise<A>,
  keys: readonly string[],
) {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames: string[] = [];
  let pending = '';

  output.on('data', (chunk: Buffer) => {
    pending += chunk.toString();
  });

  const answer = start({ input, output });

  for (const key of keys) {
    await tick();
    frames.push(stripAnsi(pending));
    pending = '';
    input.write(key);
  }

  const result = await answer;

  frames.push(stripAnsi(pending));

  return { answer: result, frames };
}

describe('blockPager', () => {
  const start = (blocks: readonly string[]) => (context: { input: PassThrough; output: PassThrough }) =>
    blockPager<string>(
      {
        blocks,
        help: '←→ cambiar',
        message: 'Monotributo',
        render: (block) => `[${block}]`,
        theme: { style: { message: (text: string) => text } },
      },
      context,
    );

  it('las flechas recorren los bloques sin pasarse de los bordes, y Enter cierra en el que esta', async () => {
    const { answer, frames } = await drive(start(['uno', 'dos', 'tres']), [
      LEFT,
      RIGHT,
      RIGHT,
      RIGHT,
      LEFT,
      'x',
      ENTER,
    ]);

    expect(answer).toBe('dos');
    expect(frames[0]).toContain('[uno]');
    // En los bordes la tecla no cambia nada: no se vuelve a dibujar.
    expect(frames[1]).toBe('');
    expect(frames[2]).toContain('[dos]');
    expect(frames[3]).toContain('[tres]');
    expect(frames[4]).toBe('');
    expect(frames[5]).toContain('[dos]');
    expect(frames[0]).toContain('←→ cambiar');
    // Al cerrarse queda solo la pregunta, sin el bloque.
    expect(frames.at(-1)).not.toContain('[dos]');
  });
});

describe('listSelect', () => {
  const start =
    <T>(
      choices: ReadonlyArray<ListSelectChoice<T> | Separator>,
      options: { readonly back?: boolean; readonly default?: T } = {},
    ) =>
    (context: { input: PassThrough; output: PassThrough }) =>
      listSelect<T, typeof BACK>(
        {
          back: options.back === false ? undefined : { label: '← Volver', value: BACK },
          choices,
          default: options.default,
          message: '¿Cuál?',
          pageSize: 5,
          theme: THEME,
        },
        context,
      );

  it('una lista vacia (sin comprobantes) arranca en "Volver"', async () => {
    const { answer, frames } = await drive(start<number>([]), [UP, ENTER]);

    expect(answer).toBe(BACK);
    expect(frames[0]).toContain('❯ ← Volver');
    expect(frames.at(-1)).toContain('← Volver');
  });

  it('una opcion por defecto apagada no arranca marcada', async () => {
    const { answer } = await drive(
      start(
        [
          { name: 'Factura A', value: 'a' },
          { disabled: '(sin CUIT)', name: 'Factura B', value: 'b' },
        ],
        { default: 'b' },
      ),
      [ENTER],
    );

    expect(answer).toBe('a');
  });

  it('Enter sobre una apagada no hace nada; su motivo se ve al lado', async () => {
    const { answer, frames } = await drive(
      start(
        [
          { disabled: '(no disponible)', name: 'Apagada', value: 'x' },
          { name: 'Prendida', value: 'y' },
        ],
        { back: false },
      ),
      [UP, ENTER, DOWN, ENTER],
    );

    expect(answer).toBe('y');
    expect(frames[0]).toContain('Apagada (no disponible)');
  });

  it('sin "Volver", bajar desde la ultima no hace nada', async () => {
    const { answer } = await drive(
      start(
        [
          { name: 'Uno', value: 1 },
          { name: 'Dos', value: 2 },
        ],
        { back: false },
      ),
      [DOWN, DOWN, DOWN, ENTER],
    );

    expect(answer).toBe(2);
  });

  it('escribir algo que no coincide no mueve; borrar limpia lo escrito', async () => {
    const { answer } = await drive(
      start([
        { name: 'Euro', value: 'eur' },
        { name: 'Dólar', value: 'usd' },
      ]),
      ['z', BACKSPACE, 'd', ENTER],
    );

    expect(answer).toBe('usd');
  });

  it('con acentos y emoji en las opciones las dibuja y las elige', async () => {
    const { answer, frames } = await drive(
      start([
        { description: 'Cliente 🧾 de Ñandú', name: 'Peña & Hijos 🏢', short: 'Peña', value: 'p' },
        new Separator('—'),
        { name: 'Ñoño', value: 'n' },
      ]),
      [ENTER],
    );

    expect(answer).toBe('p');
    expect(frames[0]).toContain('Peña & Hijos 🏢');
    expect(frames[0]).toContain('Cliente 🧾 de Ñandú');
    // Lo que queda al responder es el texto corto.
    expect(frames.at(-1)).toContain('Peña');
    expect(frames.at(-1)).not.toContain('Hijos');
  });
});

describe('multiSelect', () => {
  const start =
    (choices: ReadonlyArray<{ readonly description?: string; readonly name: string; readonly value: string }>) =>
    (context: { input: PassThrough; output: PassThrough }) =>
      multiSelect<string>(
        { backLabel: '← Volver', choices, message: '¿Opcionales?', pageSize: 2, selected: [], theme: THEME },
        context,
      );

  const CHOICES = [
    { description: 'La fecha de hoy', name: 'Fecha', value: 'fecha' },
    { name: 'Moneda', value: 'moneda' },
    { name: 'Exento', value: 'exento' },
  ];

  it('subir desde la primera no hace nada; la descripcion de la marcada se ve', async () => {
    const { answer, frames } = await drive(start(CHOICES), [UP, SPACE, ENTER]);

    expect(answer).toEqual(['fecha']);
    expect(frames[0]).toContain('La fecha de hoy');
  });

  it('con una pagina chica desplaza las opciones y "Volver" sigue debajo', async () => {
    const { answer, frames } = await drive(start(CHOICES), [DOWN, DOWN, SPACE, DOWN, DOWN, ENTER]);

    expect(answer).toBe(BACK);
    expect(frames[3]).toContain('Exento');
    expect(frames[3]).toContain('← Volver');
    // Al responder queda solo la pregunta.
    expect(frames.at(-1)).not.toContain('Exento');
  });

  it('`a` dos veces desmarca todo', async () => {
    const { answer } = await drive(start(CHOICES), ['a', 'a', ENTER]);

    expect(answer).toEqual([]);
  });

  it('una lista sin opciones solo ofrece "Volver", y espacio no hace nada', async () => {
    const { answer } = await drive(start([]), [SPACE, ENTER]);

    expect(answer).toBe(BACK);
  });
});
