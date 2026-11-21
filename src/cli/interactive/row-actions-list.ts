import {
  createPrompt,
  isBackspaceKey,
  isDownKey,
  isEnterKey,
  isSpaceKey,
  isUpKey,
  makeTheme,
  useKeypress,
  usePrefix,
  useState,
} from '@inquirer/core';

import {
  type RowEdits,
  rowEditsOf,
  type RowMarks,
  toggleEditMark,
  toggleRemoveMark,
} from '../../modules/interactive/row-marks';
import { BACK, type Back } from '../../modules/interactive/wizard';
import { renderRowActionsList, type RowActionsListRow, uiSymbol } from '../../ui';

/** Oculta el cursor de la terminal mientras se muestra la lista; @inquirer lo vuelve a mostrar al cerrarla. */
const CURSOR_HIDE = '\u001B[?25l';
/** Sin ancho conocido (un pipe, los tests), el de una terminal comun. */
const DEFAULT_WIDTH = 80;

type HelpKey = [string, string];

interface RowActionsListStyle {
  readonly style: {
    readonly keysHelpTip: (keys: HelpKey[]) => string;
  };
}

export interface RowActionsListConfig {
  readonly addLabel: string;
  readonly backLabel: string;
  readonly message: string;
  /** Las filas que quedan como minimo: Backspace no deja marcar para borrar mas alla de eso. */
  readonly minRows: number;
  /** Por que no se puede borrar, si se intenta dejar menos de `minRows`. */
  readonly minRowsNotice: string;
  readonly pageSize: number;
  readonly rows: ReadonlyArray<Omit<RowActionsListRow, 'mark'>>;
  /** Columnas disponibles; por defecto, las de la terminal. */
  readonly width?: number;
  readonly theme: {
    readonly prefix?: { readonly done: string; readonly idle: string };
    readonly spinner?: { readonly frames: string[]; readonly interval: number };
    readonly style: RowActionsListStyle['style'] & { readonly message?: (text: string, status: string) => string };
  };
}

/**
 * Lista con acciones por fila (NAV-10): espacio marca una fila para modificarla, Backspace para borrarla (otro
 * Backspace la desmarca) y Enter aplica lo marcado, o sigue sin marcas. Enter sobre "Agregar", un boton separado de la
 * lista, aplica lo marcado y agrega una fila. "Volver" queda fijo debajo, como en la seleccion multiple. Las marcas son de `modules/interactive/row-marks`; el dibujo, de
 * `renderRowActionsList`.
 */
export const rowActionsList = createPrompt(
  (config: RowActionsListConfig, done: (value: Back | RowEdits) => void): string => {
    const theme = makeTheme<RowActionsListStyle>(config.theme);
    const [status, setStatus] = useState<'done' | 'idle'>('idle');
    const [marks, setMarks] = useState<RowMarks>(() => config.rows.map(() => undefined));
    const [active, setActive] = useState(0);
    const [notice, setNotice] = useState<string | undefined>(undefined);
    const prefix = usePrefix({ status, theme });
    const addIndex = config.rows.length;
    const backIndex = addIndex + 1;

    useKeypress((key) => {
      setNotice(undefined);

      if (isEnterKey(key)) {
        setStatus('done');
        done(active === backIndex ? BACK : rowEditsOf(marks, active === addIndex));
      } else if (isUpKey(key) || isDownKey(key)) {
        const next = active + (isUpKey(key) ? -1 : 1);

        if (next >= 0 && next <= backIndex) {
          setActive(next);
        }
      } else if (isSpaceKey(key)) {
        if (active < addIndex) {
          setMarks(toggleEditMark(marks, active));
        }
      } else if (isBackspaceKey(key) && active < addIndex) {
        const next = toggleRemoveMark(marks, active, config.minRows);

        if (next) {
          setMarks(next);
        } else {
          setNotice(config.minRowsNotice);
        }
      }
    });

    const message = theme.style.message(config.message, status);

    if (status === 'done') {
      return [prefix, message].filter(Boolean).join(' ');
    }

    const list = renderRowActionsList({
      active,
      addLabel: config.addLabel,
      backLabel: config.backLabel,
      highlight: theme.style.highlight,
      notice,
      pageSize: config.pageSize,
      rows: config.rows.map((row, index) => ({ ...row, mark: marks[index] })),
      width: config.width ?? (process.stdout.columns || DEFAULT_WIDTH),
    });
    const help = theme.style.keysHelpTip([
      ['↑↓', 'navigate'],
      ['espacio', 'modificar'],
      [uiSymbol('keyBackspace'), 'borrar'],
      // Sin marcas, Enter sigue: que se vea que se puede avanzar sin tocar nada.
      [uiSymbol('keyEnter'), marks.some(Boolean) ? 'aplicar' : 'seguir'],
    ]);
    const lines = [[prefix, message].filter(Boolean).join(' '), ...list, ' ', help];

    return `${lines.join('\n').trimEnd()}${CURSOR_HIDE}`;
  },
);
