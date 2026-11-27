/**
 * Cuanto lugar ocupan las tablas en columnas del monotributo (la vista por defecto y los bloques de `--completa`): el
 * reparto del ancho entre columnas y la ventana de columnas del asistente cuando un bloque no entra. Solo cuentas
 * sobre los anchos de cada columna: el texto lo arma el presenter.
 */

/** Entre columnas: el sobrante se reparte si deja por lo menos 3; si no, 2, como las demas tablas. */
const WIDE_GAP = 3;
export const NARROW_GAP = 2;
/** Antes de la primera columna: la `❯ ` de la fila propia o dos espacios. */
export const ROW_PREFIX_WIDTH = 2;

/**
 * Los espacios entre columnas de `widths` para que la tabla ocupe `width`: el sobrante repartido en partes iguales
 * (lo que no se reparte parejo va en las primeras), si deja por lo menos 3 entre cada una; si no, 2. `undefined` si
 * no entra con `minimumGap`.
 */
export function columnGaps(widths: readonly number[], width: number, minimumGap = NARROW_GAP): number[] | undefined {
  const count = widths.length - 1;
  const free = width - ROW_PREFIX_WIDTH - widths.reduce((total, columnWidth) => total + columnWidth, 0);

  if (free < count * minimumGap) return undefined;
  if (count === 0) return [];
  if (free < count * WIDE_GAP) return Array.from({ length: count }, () => NARROW_GAP);

  const base = Math.floor(free / count);

  return Array.from({ length: count }, (_, index) => base + (index < free % count ? 1 : 0));
}

/**
 * Las columnas de un bloque que se ven a la vez en el asistente cuando no entran todas: de `first` a `last` de
 * `total`, contadas desde 1 y sin la de categoria, que va siempre.
 */
export interface ColumnWindow {
  readonly first: number;
  readonly last: number;
  readonly total: number;
}

/** De `items` (la de categoria y las de datos), la de categoria y las de datos de `first` a `last`. */
export function windowColumns<T>(items: readonly T[], first: number, last: number): T[] {
  return [...items.slice(0, 1), ...items.slice(first, last + 1)];
}

/**
 * Si las columnas de datos de `first` a `last` entran con la de categoria en `width`: con 3 espacios entre cada una
 * o, si es una sola, con 2.
 */
function windowFits(widths: readonly number[], first: number, last: number, width: number): boolean {
  const gap = first === last ? NARROW_GAP : WIDE_GAP;

  return columnGaps(windowColumns(widths, first, last), width, gap) !== undefined;
}

/**
 * Si un bloque de columnas de `widths` (la primera, la de categoria) va por ventana en `width`: no entra entero ni
 * con 2 espacios y cada columna de datos, sola con la de categoria, si entra. Si alguna no entra, el bloque va
 * apilado, entrando por cualquier lado.
 */
function usesWindow(widths: readonly number[], width: number): boolean {
  if (columnGaps(widths, width) !== undefined) return false;

  return widths.slice(1).every((_, index) => windowFits(widths, index + 1, index + 1, width));
}

/** La ventana que termina en `last`, con todas las columnas que entran hacia la izquierda. */
function endingAt(widths: readonly number[], last: number, width: number): ColumnWindow {
  let first = last;

  while (first > 1 && windowFits(widths, first - 1, last, width)) first -= 1;

  return { first, last, total: widths.length - 1 };
}

/** La ventana que empieza en `first`, con todas las columnas que entran hacia la derecha. */
function startingAt(widths: readonly number[], first: number, width: number): ColumnWindow {
  const total = widths.length - 1;
  let last = first;

  while (last < total && windowFits(widths, first, last + 1, width)) last += 1;

  return { first, last, total };
}

/**
 * La ventana con la que se entra a un bloque de columnas de `widths` (la primera, la de categoria): desde la primera
 * de datos (`side` `left`, entrando desde el bloque de la izquierda) o hasta la ultima (`right`), siempre con todas
 * las que entran. `undefined` si el bloque no va por ventana (ver `usesWindow`).
 */
export function enterColumnWindow(
  widths: readonly number[],
  side: 'left' | 'right',
  width: number,
): ColumnWindow | undefined {
  if (!usesWindow(widths, width)) return undefined;

  return side === 'left' ? startingAt(widths, 1, width) : endingAt(widths, widths.length - 1, width);
}

/**
 * La ventana corrida una columna hacia `direction`: la nueva queda pegada a ese lado y la ventana se completa hacia
 * el otro con todas las que entran, asi que puede crecer o achicarse. `undefined` si ya no hay columnas de ese lado.
 */
export function moveColumnWindow(
  widths: readonly number[],
  window: ColumnWindow,
  direction: 'left' | 'right',
  width: number,
): ColumnWindow | undefined {
  if (direction === 'right') {
    return window.last < window.total ? endingAt(widths, window.last + 1, width) : undefined;
  }

  return window.first > 1 ? startingAt(widths, window.first - 1, width) : undefined;
}
