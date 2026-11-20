import { uiSymbol } from '../primitives/symbols';
import { colorize, padEndVisible, truncateVisible, visibleWidth, wrapPlainText } from '../primitives/text';

import { scrollHint, scrollWindow } from './scrollWindow';

/** Una fila de la lista: lo que la nombra, el detalle y el total, como se muestran. */
export interface RowActionsListRow {
  /** Lo que nombra la fila (la descripcion de un item): si no entra, se recorta. */
  readonly title: string;
  /** El detalle (cantidad, unidad y precio): va en la fila si entra y, de la fila marcada, siempre debajo de la lista. */
  readonly detail: string;
  /** El total de la fila: va siempre. */
  readonly total: string;
  /** Marcada para modificar (espacio) o para borrar (Backspace). */
  readonly mark?: 'edit' | 'remove';
}

export interface RowActionsListView {
  readonly rows: readonly RowActionsListRow[];
  /** El cursor: una fila, la de agregar (`rows.length`) o "Volver" (`rows.length + 1`). */
  readonly active: number;
  /** El boton para agregar una fila, separado de la lista: Enter sobre el carga una nueva. */
  readonly addLabel: string;
  readonly backLabel: string;
  /** Filas que entran sin desplazar la lista. */
  readonly pageSize: number;
  /** Columnas disponibles. */
  readonly width: number;
  /** Como se resalta la linea del cursor. */
  readonly highlight: (text: string) => string;
  /** Un aviso debajo de la lista, por ejemplo por que no se puede borrar la ultima fila. */
  readonly notice?: string;
}

/** Lo minimo que se deja para el nombre de la fila antes de pasar a mostrar solo el total. */
const MIN_TITLE_WIDTH = 8;
const GAP = '  ';

function markIcon(mark: RowActionsListRow['mark']): string {
  if (mark === 'edit') {
    return colorize(uiSymbol('selected'), 'success');
  }

  return mark === 'remove' ? colorize(uiSymbol('removeMark'), 'danger') : uiSymbol('unselected');
}

function cursor(isActive: boolean): string {
  return isActive ? uiSymbol('pointer') : ' ';
}

/**
 * El ancho del nombre: el del mas largo, o lo que deje el detalle. Si con el detalle no queda lugar para un nombre
 * (en una terminal angosta), la fila lleva el nombre y el total, y el detalle va solo debajo de la lista.
 */
function layout(rows: readonly RowActionsListRow[], available: number): { title: number; withDetail: boolean } {
  const longestTitle = Math.max(0, ...rows.map((row) => visibleWidth(row.title)));
  const longestDetail = Math.max(0, ...rows.map((row) => visibleWidth(`${row.detail} = ${row.total}`)));
  const withDetail = Math.min(longestTitle, available - GAP.length - longestDetail);

  if (withDetail >= Math.min(longestTitle, MIN_TITLE_WIDTH)) {
    return { title: withDetail, withDetail: true };
  }

  const longestTotal = Math.max(0, ...rows.map((row) => visibleWidth(row.total)));

  return { title: Math.max(1, Math.min(longestTitle, available - GAP.length - longestTotal)), withDetail: false };
}

function renderRow(row: RowActionsListRow, titleWidth: number, withDetail: boolean, available: number): string {
  const title = padEndVisible(truncateVisible(row.title, titleWidth, uiSymbol('ellipsis')), titleWidth);
  const right = withDetail ? `${row.detail} = ${row.total}` : row.total;

  return truncateVisible(`${title}${GAP}${right}`, available, uiSymbol('ellipsis'));
}

/** "1 para modificar · 2 para borrar": lo que va a aplicar Enter, sin color (NO_COLOR) tambien. */
function summary(view: RowActionsListView): string {
  const edit = view.rows.filter((row) => row.mark === 'edit').length;
  const remove = view.rows.filter((row) => row.mark === 'remove').length;
  const parts = [
    edit > 0 ? `${edit} para modificar` : undefined,
    remove > 0 ? `${remove} para borrar` : undefined,
  ].filter(Boolean);

  return parts.join(` ${uiSymbol('separator')} `);
}

/**
 * La lista con acciones por fila del asistente (NAV-10): cada fila con su marca (◯ sin marca, ◉ para modificar, ● rojo
 * para borrar) y, separados de la lista, el boton para agregar y "Volver". Devuelve las lineas, sin la pregunta ni la
 * ayuda de teclas, que pone el prompt. Las filas son de una linea, recortadas al ancho, asi la lista se desplaza entera.
 */
export function renderRowActionsList(view: RowActionsListView): string[] {
  const { rows } = view;
  // El cursor y la marca: "❯ ◯ " (o "> [ ] " con ARCLI_ASCII=1).
  const prefixWidth = visibleWidth(`${cursor(true)} ${uiSymbol('unselected')} `);
  const available = Math.max(1, view.width - prefixWidth);
  const { title, withDetail } = layout(rows, available);
  const addIndex = rows.length;
  const line = (text: string, isActive: boolean) => {
    const drawn = `${cursor(isActive)} ${text}`;

    return isActive ? view.highlight(drawn) : drawn;
  };
  const window = scrollWindow(rows.length, Math.min(view.active, rows.length - 1), view.pageSize);
  const activeRow = rows[view.active];
  const status = summary(view);

  return [
    ...(window.scrolls ? [scrollHint('above', window.start)] : []),
    ...rows.slice(window.start, window.end).map((row, offset) => {
      const index = window.start + offset;

      return line(`${markIcon(row.mark)} ${renderRow(row, title, withDetail, available)}`, index === view.active);
    }),
    ...(window.scrolls ? [scrollHint('below', rows.length - window.end)] : []),
    ' ',
    line(view.addLabel, view.active === addIndex),
    ' ',
    line(view.backLabel, view.active === addIndex + 1),
    ' ',
    // El detalle de la fila del cursor, entero: en una terminal angosta no entra en la fila.
    ...(activeRow
      ? wrapPlainText(`${activeRow.detail} = ${activeRow.total}`, view.width).map((text) => colorize(text, 'info'))
      : []),
    ...(status ? [colorize(status, 'muted')] : []),
    ...(view.notice ? [colorize(view.notice, 'warning')] : []),
  ];
}
