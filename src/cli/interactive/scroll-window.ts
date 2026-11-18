import { colorize, uiSymbol } from '../../ui';

export interface ScrollWindow {
  /** Primera fila visible. */
  readonly start: number;
  /** Fila siguiente a la ultima visible. */
  readonly end: number;
  /** Si la lista no entra en la pagina y se desplaza. */
  readonly scrolls: boolean;
}

/**
 * Las filas visibles de una lista de `total` filas de una linea, con la marcada en el medio de la pagina mientras se
 * pueda y pegada al borde cerca del principio o del final, como `usePagination` de @inquirer sin `loop`.
 */
export function scrollWindow(total: number, active: number, pageSize: number): ScrollWindow {
  if (total <= pageSize) {
    return { end: total, scrolls: false, start: 0 };
  }

  const start = Math.min(Math.max(0, active - Math.floor(pageSize / 2)), total - pageSize);

  return { end: start + pageSize, scrolls: true, start };
}

/**
 * La linea que avisa cuantas opciones quedan fuera de la pagina, arriba ("↑ 3 más") o abajo ("↓ 12 más"). Sin
 * opciones ocultas de ese lado, una linea en blanco: asi la lista no salta al empezar a desplazarse.
 */
export function scrollHint(direction: 'above' | 'below', hidden: number): string {
  if (hidden <= 0) {
    return ' ';
  }

  return colorize(`  ${uiSymbol(direction === 'above' ? 'moreAbove' : 'moreBelow')} ${hidden} más`, 'muted');
}
