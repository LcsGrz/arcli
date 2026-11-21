import { describe, expect, it } from 'vitest';

import { applyRowEdits, rowEditsOf, type RowMarks, toggleEditMark, toggleRemoveMark } from '../row-marks';

const NONE: RowMarks = [undefined, undefined, undefined];

describe('marcas de la lista con acciones por fila (NAV-10)', () => {
  it('espacio marca para modificar y otro espacio desmarca; una marcada para borrar pasa a modificarse', () => {
    expect(toggleEditMark(NONE, 1)).toEqual([undefined, 'edit', undefined]);
    expect(toggleEditMark([undefined, 'edit', undefined], 1)).toEqual([undefined, undefined, undefined]);
    expect(toggleEditMark(['remove', undefined, 'edit'], 0)).toEqual(['edit', undefined, 'edit']);
  });

  it('Backspace marca para borrar y otro Backspace desmarca; una marcada para modificar pasa a borrarse', () => {
    expect(toggleRemoveMark(NONE, 2, 1)).toEqual([undefined, undefined, 'remove']);
    expect(toggleRemoveMark([undefined, undefined, 'remove'], 2, 1)).toEqual([undefined, undefined, undefined]);
    expect(toggleRemoveMark(['edit', undefined, undefined], 0, 1)).toEqual(['remove', undefined, undefined]);
  });

  it('no deja marcar para borrar si quedarían menos filas que el mínimo: la última no se borra', () => {
    expect(toggleRemoveMark(['remove', 'remove', undefined], 2, 1)).toBeUndefined();
    expect(toggleRemoveMark([undefined], 0, 1)).toBeUndefined();
    // Justo el mínimo, sí.
    expect(toggleRemoveMark(['remove', undefined, undefined], 1, 1)).toEqual(['remove', 'remove', undefined]);
    // Una marcada para modificar cuenta como fila que queda.
    expect(toggleRemoveMark(['remove', 'edit', undefined], 2, 1)).toEqual(['remove', 'edit', 'remove']);
    // Desmarcar siempre se puede, y sin mínimo se borra todo.
    expect(toggleRemoveMark(['remove'], 0, 1)).toEqual([undefined]);
    expect(toggleRemoveMark([undefined], 0, 0)).toEqual(['remove']);
  });

  it('Enter: las posiciones de cada marca, en orden, y si se agrega', () => {
    expect(rowEditsOf(['remove', 'edit', undefined, 'edit'], true)).toEqual({ add: true, edit: [1, 3], remove: [0] });
    expect(rowEditsOf(NONE, false)).toEqual({ add: false, edit: [], remove: [] });
  });

  it('aplicar: sin las borradas, y las que se modifican con su posición en la lista nueva', () => {
    expect(applyRowEdits(['a', 'b', 'c', 'd'], { edit: [1, 3], remove: [0, 2] })).toEqual({
      edit: [0, 1],
      rows: ['b', 'd'],
    });
    expect(applyRowEdits(['a', 'b'], { edit: [], remove: [] })).toEqual({ edit: [], rows: ['a', 'b'] });
    expect(applyRowEdits(['a', 'b'], { edit: [0], remove: [0] })).toEqual({ edit: [], rows: ['b'] });
  });
});
