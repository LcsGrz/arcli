import {
  createPrompt,
  isDownKey,
  isEnterKey,
  isSpaceKey,
  isUpKey,
  makeTheme,
  useKeypress,
  usePrefix,
  useState,
} from '@inquirer/core';

import { BACK, type Back } from '../../modules/interactive/wizard';
import { colorize, scrollHint, scrollWindow, uiSymbol } from '../../ui';

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

/**
 * Seleccion multiple con un boton "Volver". @inquirer/checkbox le pone el circulo a todas las filas y `a` e `i` las
 * marcan a todas, asi que "Volver" terminaba seleccionable junto con las opciones. "Volver" queda fijo debajo de la
 * lista aunque las opciones se desplacen.
 */
export const multiSelect = createPrompt(
  <T>(config: MultiSelectConfig<T>, done: (value: Back | T[]) => void): string => {
    const theme = makeTheme<MultiSelectStyle>(config.theme);
    const [status, setStatus] = useState<'done' | 'idle'>('idle');
    const [marked, setMarked] = useState<readonly T[]>(config.selected);
    const [active, setActive] = useState(0);
    const prefix = usePrefix({ status, theme });
    const values = config.choices.map((choice) => choice.value);
    // "Volver" va despues de la ultima opcion.
    const backIndex = config.choices.length;
    const row = config.choices[active];

    useKeypress((key) => {
      if (isEnterKey(key)) {
        setStatus('done');
        // En el orden de las opciones, no en el que se marcaron.
        done(active === backIndex ? BACK : values.filter((value) => marked.includes(value)));
      } else if (isUpKey(key) || isDownKey(key)) {
        const next = active + (isUpKey(key) ? -1 : 1);

        if (next >= 0 && next <= backIndex) {
          setActive(next);
        }
      } else if (isSpaceKey(key)) {
        if (row) {
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

    const renderRow = (label: string, isActive: boolean) => {
      const line = `${isActive ? uiSymbol('pointer') : ' '} ${label}`;

      return isActive ? theme.style.highlight(line) : line;
    };
    // Con "Volver" marcado, la pagina queda al final, porque se llega desde la ultima opcion.
    const window = scrollWindow(config.choices.length, Math.min(active, backIndex - 1), config.pageSize);
    const options = config.choices.slice(window.start, window.end).map((choice, offset) => {
      const icon = marked.includes(choice.value) ? colorize(uiSymbol('selected'), 'success') : uiSymbol('unselected');

      return renderRow(`${icon} ${choice.name}`, window.start + offset === active);
    });
    const message = theme.style.message(config.message, status);

    if (status === 'done') {
      return [prefix, message].filter(Boolean).join(' ');
    }

    const description = row?.description;
    const help = theme.style.keysHelpTip([
      ['↑↓', 'navigate'],
      ['space', 'select'],
      ['a', 'all'],
      ['i', 'invert'],
      ['⏎', 'submit'],
    ]);
    const lines = [
      [prefix, message].filter(Boolean).join(' '),
      ...(window.scrolls ? [scrollHint('above', window.start)] : []),
      ...options,
      ...(window.scrolls ? [scrollHint('below', config.choices.length - window.end)] : []),
      ' ',
      renderRow(config.backLabel, active === backIndex),
      ' ',
      description ? theme.style.description(description) : '',
      help,
    ];

    return `${lines.filter(Boolean).join('\n').trimEnd()}${CURSOR_HIDE}`;
  },
);
