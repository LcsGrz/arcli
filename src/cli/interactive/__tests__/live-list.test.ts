import { Separator } from '@inquirer/core';
import { afterEach, describe, expect, it } from 'vitest';

import type { ListSelectChoice } from '../list-select';
import { liveListFits } from '../live-list';

const originalColumns = process.stdout.columns;
const originalRows = process.stdout.rows;

function resize(columns: number, rows: number): void {
  process.stdout.columns = columns;
  process.stdout.rows = rows;
}

afterEach(() => resize(originalColumns, originalRows));

type Choices = ReadonlyArray<ListSelectChoice<number> | Separator>;

const options = (count: number, name = 'Opción', description?: string): Array<ListSelectChoice<number>> =>
  Array.from({ length: count }, (_, value) => ({ description, name, value }));
const separators = (count: number) => Array.from({ length: count }, () => new Separator(' '));

/**
 * El alto justo, con 3 opciones: 8 fijas + 3 opciones + 2 (filtro o separadores) + 1 de descripcion + 1 de ayuda de
 * teclas = 15, mas lo de arriba y su linea en blanco.
 */
const CASES: ReadonlyArray<readonly [name: string, columns: number, choices: Choices, tops: string[], rows: number]> = [
  ['sin nada arriba', 80, options(3), [], 15],
  ['vacío arriba es como nada', 80, options(3), [''], 15],
  ['una línea arriba y su línea en blanco', 80, options(3), ['barra'], 17],
  ['varias líneas arriba', 80, options(3), ['barra\n\n┌\naviso\n└'], 21],
  ['el más alto de los de arriba', 80, options(3), ['a\nb\nc', 'a', 'a\nb'], 19],
  ['una línea justo del ancho no se parte', 80, options(3), ['x'.repeat(80)], 17],
  ['una más ancha se parte', 80, options(3), ['x'.repeat(81)], 18],
  ['dos separadores entran en el lugar del filtro', 80, [...options(3), ...separators(2)], [], 15],
  ['el tercero suma', 80, [...options(3), ...separators(3)], [], 16],
  ['una opción más', 80, options(4), [], 16],
  // El cursor ocupa dos columnas: 78 entran, 79 no.
  ['un nombre que entra justo', 80, options(3, 'x'.repeat(78)), [], 15],
  ['un nombre que se parte', 80, options(3, 'x'.repeat(79)), [], 18],
  ['los colores no ocupan', 80, options(3, `\u001B[31m${'x'.repeat(78)}\u001B[39m`), [], 15],
  ['la descripción que se parte', 80, options(3, 'a', 'x'.repeat(81)), [], 16],
  ['la descripción más alta', 80, [...options(2), { description: 'x'.repeat(161), name: 'a', value: 9 }], [], 17],
  ['más ancha no cambia', 200, options(3), [], 15],
  // La ayuda de teclas, de hasta 80 columnas, se parte en dos.
  ['angosta', 79, options(3), [], 16],
  ['muy angosta', 40, options(3, 'x'.repeat(39), 'x'.repeat(41)), ['x'.repeat(41)], 23],
  ['sin ancho conocido, 80 columnas', 0, options(3, 'x'.repeat(79)), [], 18],
];

describe('liveListFits', () => {
  it.each(CASES)('%s', (_name, columns, choices, tops, rows) => {
    resize(columns, rows);
    expect(liveListFits(choices, tops)).toBe(true);
    resize(columns, rows - 1);
    expect(liveListFits(choices, tops)).toBe(false);
  });

  it('sin alto conocido, 24 filas', () => {
    resize(80, 0);
    expect(liveListFits(options(12), [])).toBe(true);
    expect(liveListFits(options(13), [])).toBe(false);
  });
});
