import {
  createPrompt,
  isDownKey,
  isEnterKey,
  isSpaceKey,
  isUpKey,
  makeTheme,
  useKeypress,
  usePagination,
  usePrefix,
  useState,
} from '@inquirer/core';

import { BACK, type Back } from '../../modules/interactive/wizard';
import { colorize, uiSymbol } from '../../ui';

/** Oculta el cursor de la terminal mientras se muestra la lista; @inquirer lo vuelve a mostrar al cerrarla. */
const CURSOR_HIDE = '\u001B[?25l';

type HelpKey = [string, string];

interface MultiSelectStyle {
  readonly style: {
    readonly description: (text: string) => string;
    readonly keysHelpTip: (keys: HelpKey[]) => string;
  };
}

export interface MultiSelectConfig<T> {
  readonly backLabel: string;
  readonly choices: ReadonlyArray<{
    readonly description?: string;
    readonly name: string;
    readonly value: T;
  }>;
  readonly message: string;
  readonly pageSize: number;
  readonly selected: readonly T[];
  readonly theme: {
    readonly prefix?: { readonly done: string; readonly idle: string };
    readonly spinner?: { readonly frames: string[]; readonly interval: number };
    readonly style: MultiSelectStyle['style'] & { readonly message?: (text: string, status: string) => string };
  };
}

type Row<T> =
  | { readonly kind: 'back' }
  | { readonly kind: 'spacer' }
  | { readonly description?: string; readonly kind: 'option'; readonly name: string; readonly value: T };

/**
 * Seleccion multiple con un boton "Volver". @inquirer/checkbox le pone el circulo a todas las filas y `a` e `i` las
 * marcan a todas, asi que "Volver" terminaba seleccionable junto con las opciones.
 */
export const multiSelect = createPrompt(
  <T>(config: MultiSelectConfig<T>, done: (value: Back | T[]) => void): string => {
    const theme = makeTheme<MultiSelectStyle>(config.theme);
    const [status, setStatus] = useState<'done' | 'idle'>('idle');
    const [marked, setMarked] = useState<readonly T[]>(config.selected);
    const [active, setActive] = useState(0);
    const prefix = usePrefix({ status, theme });
    const values = config.choices.map((choice) => choice.value);
    const rows: ReadonlyArray<Row<T>> = [
      ...config.choices.map((choice) => ({ ...choice, kind: 'option' as const })),
      { kind: 'spacer' },
      { kind: 'back' },
    ];
    const backIndex = rows.length - 1;

    useKeypress((key) => {
      const row = rows[active];

      if (isEnterKey(key)) {
        setStatus('done');
        // En el orden de las opciones, no en el que se marcaron.
        done(row?.kind === 'back' ? BACK : values.filter((value) => marked.includes(value)));
      } else if (isUpKey(key) || isDownKey(key)) {
        const offset = isUpKey(key) ? -1 : 1;
        const next = active + offset;
        // El separador no se puede elegir: se salta.
        const target = rows[next]?.kind === 'spacer' ? next + offset : next;

        if (target >= 0 && target <= backIndex) {
          setActive(target);
        }
      } else if (isSpaceKey(key)) {
        if (row?.kind === 'option') {
          setMarked(
            marked.includes(row.value) ? marked.filter((value) => value !== row.value) : [...marked, row.value],
          );
        }
      } else if (key.name === 'a') {
        setMarked(values.every((value) => marked.includes(value)) ? [] : values);
      } else if (key.name === 'i') {
        setMarked(values.filter((value) => !marked.includes(value)));
      }
    });

    const page = usePagination({
      active,
      items: rows,
      loop: false,
      pageSize: config.pageSize,
      renderItem({ isActive, item }) {
        if (item.kind === 'spacer') {
          return ' ';
        }

        const cursor = isActive ? uiSymbol('pointer') : ' ';
        const color = isActive ? theme.style.highlight : (text: string) => text;

        if (item.kind === 'back') {
          return color(`${cursor} ${config.backLabel}`);
        }

        const icon = marked.includes(item.value) ? colorize(uiSymbol('selected'), 'success') : uiSymbol('unselected');

        return color(`${cursor} ${icon} ${item.name}`);
      },
    });
    const message = theme.style.message(config.message, status);

    if (status === 'done') {
      return [prefix, message].filter(Boolean).join(' ');
    }

    const activeRow = rows[active];
    const description = activeRow?.kind === 'option' ? activeRow.description : undefined;
    const help = theme.style.keysHelpTip([
      ['↑↓', 'navigate'],
      ['space', 'select'],
      ['a', 'all'],
      ['i', 'invert'],
      ['⏎', 'submit'],
    ]);
    const lines = [
      [prefix, message].filter(Boolean).join(' '),
      page,
      ' ',
      description ? theme.style.description(description) : '',
      help,
    ];

    return `${lines.filter(Boolean).join('\n').trimEnd()}${CURSOR_HIDE}`;
  },
);
