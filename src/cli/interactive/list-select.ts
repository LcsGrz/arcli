import {
  createPrompt,
  isBackspaceKey,
  isDownKey,
  isEnterKey,
  isUpKey,
  makeTheme,
  Separator,
  useEffect,
  useKeypress,
  useMemo,
  usePrefix,
  useRef,
  useState,
} from '@inquirer/core';

import { colorize, uiSymbol } from '../../ui';

import { scrollHint, scrollWindow } from './scroll-window';

/** Oculta el cursor de la terminal mientras se muestra la lista; @inquirer lo vuelve a mostrar al cerrarla. */
const CURSOR_HIDE = '\u001B[?25l';

type HelpKey = [string, string];

export interface ListSelectChoice<T> {
  readonly description?: string;
  /** Se ve apagada y Enter no la elige; con texto, ese texto va al lado (por ejemplo "(sin datos)"). */
  readonly disabled?: boolean | string;
  readonly name: string;
  readonly short?: string;
  readonly value: T;
}

interface ListSelectStyle {
  readonly style: {
    readonly description: (text: string) => string;
    readonly keysHelpTip: (keys: HelpKey[]) => string;
  };
}

export interface ListSelectConfig<T, B> {
  /** Boton fijo debajo de la lista ("← Volver"), separado por una linea en blanco: no se desplaza con las opciones. */
  readonly back?: { readonly label: string; readonly value: B };
  readonly choices: ReadonlyArray<ListSelectChoice<T> | Separator>;
  readonly default?: B | T;
  readonly message: string;
  /** Filas de opciones visibles; si no entran todas, la lista se desplaza y avisa cuantas quedan arriba y abajo. */
  readonly pageSize: number;
  readonly theme: {
    readonly prefix?: { readonly done: string; readonly idle: string };
    readonly spinner?: { readonly frames: string[]; readonly interval: number };
    readonly style: ListSelectStyle['style'] & { readonly message?: (text: string, status: string) => string };
  };
}

/** La posicion de "Volver": despues de la ultima opcion. */
const BACK_ROW = -1;
/** Lo que se escribe para saltar a una opcion se olvida despues de esta pausa, como en @inquirer/select. */
const SEARCH_RESET_MS = 700;

/**
 * Lista para elegir una opcion, como @inquirer/select, pero con "Volver" fijo debajo de la parte que se desplaza y
 * con un aviso de las opciones que no se ven ("↑ 3 más", "↓ 12 más"). En @inquirer/select "Volver" era una opcion
 * mas y se iba de la pantalla con el resto.
 */
export const listSelect = createPrompt(
  <T, B = never>(config: ListSelectConfig<T, B>, done: (value: B | T) => void): string => {
    const theme = makeTheme<ListSelectStyle>(config.theme);
    const [status, setStatus] = useState<'done' | 'idle'>('idle');
    const prefix = usePrefix({ status, theme });
    const items = config.choices;
    const navigable = useMemo(
      () => items.flatMap((item, index) => (Separator.isSeparator(item) ? [] : [index])),
      [items],
    );
    const [active, setActive] = useState(() => {
      if (config.back && config.default === config.back.value) {
        return BACK_ROW;
      }

      const index = items.findIndex(
        (item) => !Separator.isSeparator(item) && !item.disabled && item.value === config.default,
      );

      return index === -1 ? (navigable[0] ?? BACK_ROW) : index;
    });
    const activeItem = active === BACK_ROW ? undefined : (items[active] as ListSelectChoice<T> | undefined);
    const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    useEffect(() => () => clearTimeout(searchTimeout.current), []);

    useKeypress((key, rl) => {
      clearTimeout(searchTimeout.current);

      if (isEnterKey(key)) {
        if (active === BACK_ROW && config.back) {
          setStatus('done');
          done(config.back.value);
        } else if (activeItem && !activeItem.disabled) {
          setStatus('done');
          done(activeItem.value);
        }
      } else if (isUpKey(key) || isDownKey(key)) {
        rl.clearLine(0);

        // Las filas que se recorren con las flechas, con "Volver" al final.
        const order = config.back ? [...navigable, BACK_ROW] : navigable;
        const next = order[order.indexOf(active) + (isUpKey(key) ? -1 : 1)];

        if (next !== undefined) {
          setActive(next);
        }
      } else if (isBackspaceKey(key)) {
        rl.clearLine(0);
      } else {
        // Escribir el principio de una opcion la marca, como en @inquirer/select.
        const term = rl.line.toLowerCase();
        const match = items.findIndex(
          (item) => !Separator.isSeparator(item) && !item.disabled && item.name.toLowerCase().startsWith(term),
        );

        if (term && match !== -1) {
          setActive(match);
        }

        searchTimeout.current = setTimeout(() => rl.clearLine(0), SEARCH_RESET_MS);
      }
    });

    const message = theme.style.message(config.message, status);

    if (status === 'done') {
      const answer = activeItem ? (activeItem.short ?? activeItem.name) : (config.back?.label ?? '');

      return [prefix, message, theme.style.answer(answer)].filter(Boolean).join(' ');
    }

    // Con "Volver" marcado, la pagina queda donde estaba: al final, porque se llega desde la ultima opcion.
    const anchor = active === BACK_ROW ? items.length - 1 : active;
    const page = scrollWindow(items.length, anchor, config.pageSize);
    const countOptions = (from: number, to: number) =>
      items.slice(from, to).filter((item) => !Separator.isSeparator(item)).length;
    const renderRow = (label: string, isActive: boolean) => {
      const line = `${isActive ? uiSymbol('pointer') : ' '} ${label}`;

      return isActive ? theme.style.highlight(line) : line;
    };
    const rows = items.slice(page.start, page.end).map((item, offset) => {
      if (Separator.isSeparator(item)) {
        return ` ${item.separator}`;
      }

      const isActive = page.start + offset === active;

      if (item.disabled) {
        const label = typeof item.disabled === 'string' ? `${item.name} ${item.disabled}` : item.name;

        return colorize(`${isActive ? uiSymbol('pointer') : ' '} ${label}`, 'muted');
      }

      return renderRow(item.name, isActive);
    });
    const help = theme.style.keysHelpTip([
      ['↑↓', 'navigate'],
      ['⏎', 'select'],
    ]);
    const lines = [
      [prefix, message].filter(Boolean).join(' '),
      ...(page.scrolls ? [scrollHint('above', countOptions(0, page.start))] : []),
      ...rows,
      ...(page.scrolls ? [scrollHint('below', countOptions(page.end, items.length))] : []),
      ...(config.back ? [' ', renderRow(config.back.label, active === BACK_ROW)] : []),
      ' ',
      activeItem?.description ? theme.style.description(activeItem.description) : '',
      help,
    ];

    return `${lines.filter(Boolean).join('\n').trimEnd()}${CURSOR_HIDE}`;
  },
);
