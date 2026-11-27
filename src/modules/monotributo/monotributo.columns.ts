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

/** Si las columnas de `first` a `last` entran en `width`, con `minimumGap` entre cada una. */
function fits(widths: readonly number[], [first, last]: readonly [number, number], width: number, gap: number) {
  return columnGaps(windowColumns(widths, first, last), width, gap) !== undefined;
}

/**
 * La ventana con la que se entra a un bloque de columnas de `widths` (la primera, la de categoria): desde la primera
 * de datos (`side` `left`, entrando desde el bloque de la izquierda) o hasta la ultima (`right`), con todas las que
 * entran con 3 espacios entre cada una. `undefined` si el bloque entra entero (no hace falta ventana) o si no entra
 * ni una columna (va apilado).
 */
export function enterColumnWindow(
  widths: readonly number[],
  side: 'left' | 'right',
  width: number,
): ColumnWindow | undefined {
  const total = widths.length - 1;

  if (fits(widths, [1, total], width, NARROW_GAP)) return undefined;

  if (side === 'left') {
    let last = 0;

    while (last < total && fits(widths, [1, last + 1], width, WIDE_GAP)) last += 1;

    return last === 0 ? undefined : { first: 1, last, total };
  }

  let first = total + 1;

  while (first > 1 && fits(widths, [first - 1, total], width, WIDE_GAP)) first -= 1;

  return first > total ? undefined : { first, last: total, total };
}

/**
 * La ventana corrida una columna hacia `direction`: la nueva entra pegada a ese lado y del otro sale una (o las que
 * hagan falta para que entre). `undefined` si ya no hay columnas de ese lado.
 */
export function moveColumnWindow(
  widths: readonly number[],
  window: ColumnWindow,
  direction: 'left' | 'right',
  width: number,
): ColumnWindow | undefined {
  if (direction === 'right') {
    if (window.last >= window.total) return undefined;

    const last = window.last + 1;
    let first = Math.min(window.first + 1, last);

    while (first < last && !fits(widths, [first, last], width, WIDE_GAP)) first += 1;

    return { first, last, total: window.total };
  }

  if (window.first <= 1) return undefined;

  const first = window.first - 1;
  let last = Math.max(window.last - 1, first);

  while (last > first && !fits(widths, [first, last], width, WIDE_GAP)) last -= 1;

  return { first, last, total: window.total };
}
