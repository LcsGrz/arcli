/**
 * Las marcas de la lista con acciones por fila del asistente (los items de la E, NAV-10): cada fila se marca para
 * modificarla o para borrarla, y Enter aplica todo junto. Puro: el prompt de `cli` solo traduce las teclas.
 */

/** Modificar (espacio) o borrar (Backspace). */
export type RowMark = 'edit' | 'remove';

/** La marca de cada fila, en el orden de la lista; `undefined`, sin marca. */
export type RowMarks = ReadonlyArray<RowMark | undefined>;

/** Lo que se eligio al apretar Enter: que filas se vuelven a preguntar, cuales se borran y si se agrega una. */
export interface RowEdits {
  /** Por su posicion en la lista de antes, en orden. */
  readonly edit: readonly number[];
  /** Por su posicion en la lista de antes, en orden. */
  readonly remove: readonly number[];
  readonly add: boolean;
}

function withMark(marks: RowMarks, index: number, mark: RowMark | undefined): Array<RowMark | undefined> {
  return marks.map((current, position) => (position === index ? mark : current));
}

/** Espacio: marca la fila para modificarla, o la desmarca. Una marcada para borrar pasa a modificarse. */
export function toggleEditMark(marks: RowMarks, index: number): Array<RowMark | undefined> {
  return withMark(marks, index, marks[index] === 'edit' ? undefined : 'edit');
}

/** Cuantas filas quedan si se aplican las marcas. */
function keptRowCount(marks: RowMarks): number {
  return marks.filter((mark) => mark !== 'remove').length;
}

/**
 * Backspace: marca la fila para borrarla, o la desmarca. `undefined` si borrarla dejaria menos de `min` filas: la
 * lista no lo permite (los items de la E, por ejemplo, son al menos uno).
 */
export function toggleRemoveMark(marks: RowMarks, index: number, min: number): Array<RowMark | undefined> | undefined {
  if (marks[index] === 'remove') {
    return withMark(marks, index, undefined);
  }

  const next = withMark(marks, index, 'remove');

  return keptRowCount(next) < min ? undefined : next;
}

/** Las marcas como se aplican: las posiciones de cada una y si se agrega una fila. */
export function rowEditsOf(marks: RowMarks, add: boolean): RowEdits {
  const positions = (wanted: RowMark) => marks.flatMap((mark, index) => (mark === wanted ? [index] : []));

  return { add, edit: positions('edit'), remove: positions('remove') };
}

/**
 * Las filas sin las borradas, y las que se vuelven a preguntar con su posicion en esa lista nueva (en orden). Una fila
 * marcada para modificar y para borrar a la vez no puede venir del prompt; si viene, se borra.
 */
export function applyRowEdits<T>(
  rows: readonly T[],
  edits: Pick<RowEdits, 'edit' | 'remove'>,
): { readonly edit: number[]; readonly rows: T[] } {
  const kept: T[] = [];
  const edit: number[] = [];

  rows.forEach((row, index) => {
    if (edits.remove.includes(index)) {
      return;
    }

    if (edits.edit.includes(index)) {
      edit.push(kept.length);
    }

    kept.push(row);
  });

  return { edit, rows: kept };
}
