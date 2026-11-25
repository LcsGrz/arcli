import type { Separator } from '@inquirer/core';

import { visibleWidth } from '../../ui';

import type { ListSelectChoice } from './list-select';

/** El prefijo, la pregunta, las lineas en blanco y las de la opcion que se puede sumar, con su separador. */
const CHROME_LINES = 8;
/** "Filtrar:" y su linea en blanco, que aparecen cuando se ocultan los separadores. */
const FILTER_LINES = 2;
/** Lo que puede medir la ayuda de teclas (con `ARCLI_ASCII=1` es mas larga). */
const HELP_WIDTH = 80;
const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;

/**
 * Si la lista entra entera en la terminal con cualquiera de los `tops`. Si no, al redibujarla quedarian lineas de mas:
 * @inquirer no puede borrar las que ya se desplazaron.
 */
export function liveListFits<T>(
  choices: ReadonlyArray<ListSelectChoice<T> | Separator>,
  tops: readonly string[],
): boolean {
  const columns = process.stdout.columns || DEFAULT_COLUMNS;
  const linesOf = (width: number): number => Math.max(1, Math.ceil(width / columns));
  const height = (text: string): number =>
    text.split('\n').reduce((total, line) => total + linesOf(visibleWidth(line)), 0);
  const options = choices.filter((item): item is ListSelectChoice<T> => 'value' in item);
  // Cada fila lleva adelante el lugar del cursor.
  const rows = options.reduce((total, { name }) => total + linesOf(visibleWidth(name) + 2), 0);
  const separators = Math.max(FILTER_LINES, choices.length - options.length);
  const description = Math.max(1, ...options.map((option) => height(option.description ?? '')));
  const top = Math.max(0, ...tops.map((text) => (text ? height(text) + 1 : 0)));

  return (
    top + CHROME_LINES + rows + separators + description + linesOf(HELP_WIDTH) <= (process.stdout.rows || DEFAULT_ROWS)
  );
}
