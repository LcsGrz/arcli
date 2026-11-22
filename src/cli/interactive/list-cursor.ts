import { isDownKey, isUpKey, type KeypressEvent, useState } from '@inquirer/core';

/** Si la tecla mueve el cursor de una lista (↑ o ↓). */
export function isCursorKey(key: KeypressEvent): boolean {
  return isUpKey(key) || isDownKey(key);
}

/** Las filas `0` a `count - 1`, en orden: lo que recorren las flechas en una lista sin filtro. */
export function cursorRows(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

/**
 * El cursor de las listas del asistente: la fila marcada y como la mueven ↑ y ↓. `order` son las filas que se recorren,
 * en orden y con "Volver" al final; el cursor no pasa de la primera ni de la ultima (las listas no dan la vuelta).
 * `move` devuelve la fila nueva, o `undefined` si la tecla no es una flecha o el cursor ya estaba en el borde.
 */
export function useListCursor(initial: number | (() => number)) {
  const [active, setActive] = useState(initial);

  const move = (key: KeypressEvent, order: readonly number[]): number | undefined => {
    if (!isCursorKey(key)) {
      return undefined;
    }

    const next = order[order.indexOf(active) + (isUpKey(key) ? -1 : 1)];

    if (next !== undefined) {
      setActive(next);
    }

    return next;
  };

  return { active, move, setActive };
}
