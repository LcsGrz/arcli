import {
  createPrompt,
  isDownKey,
  isEnterKey,
  isUpKey,
  makeTheme,
  Separator,
  useKeypress,
  useMemo,
  usePrefix,
  useState,
} from '@inquirer/core';

import { colorize, scrollHint, scrollWindow, uiSymbol } from '../../ui';

import { filterCountLine, filterPromptLine, matchesSearch, noMatchesLine } from './filter-list';

/** Oculta el cursor de la terminal mientras se muestra la lista; @inquirer lo vuelve a mostrar al cerrarla. */
const CURSOR_HIDE = '\u001B[?25l';

type HelpKey = [string, string];

export interface ListSelectChoice<T> {
  readonly description?: string;
  /** Se ve apagada y Enter no la elige; con texto, ese texto va al lado (por ejemplo "(sin datos)"). */
  readonly disabled?: boolean | string;
  /** Lo que se compara con lo escrito, ademas del nombre: por ejemplo, el codigo de ARCA de una moneda. */
  readonly keywords?: string;
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
/** Ninguna marcada: lo escrito no coincide con ninguna opcion. Enter no hace nada y ↓ marca la primera que haya. */
const NO_ROW = -2;
/** Las lineas que suman "Filtrar:" y su linea en blanco: la pagina se achica para que "Volver" no se vaya de la pantalla. */
const FILTER_LINES = 2;

function isOption<T>(item: ListSelectChoice<T> | Separator): item is ListSelectChoice<T> {
  return !Separator.isSeparator(item);
}

/**
 * Lista para elegir una opcion, como @inquirer/select, pero con "Volver" fijo debajo de la parte que se desplaza y
 * con un aviso de las opciones que no se ven ("↑ 3 más", "↓ 12 más"). En @inquirer/select "Volver" era una opcion
 * mas y se iba de la pantalla con el resto.
 *
 * Escribir filtra las opciones con la misma busqueda que `filterList` (`matchesSearch`: sin tildes, por palabras y por
 * `keywords`). Lo escrito se ve en "Filtrar:" y queda hasta que se borra con Backspace; sin nada escrito, la lista se
 * ve como siempre.
 */
export const listSelect = createPrompt(
  <T, B = never>(config: ListSelectConfig<T, B>, done: (value: B | T) => void): string => {
    const theme = makeTheme<ListSelectStyle>(config.theme);
    const [status, setStatus] = useState<'done' | 'idle'>('idle');
    const [term, setTerm] = useState('');
    const prefix = usePrefix({ status, theme });
    const items = config.choices;
    // Con algo escrito, solo las opciones que coinciden y sin separadores; las posiciones son las de `items`.
    const shown = useMemo(
      () =>
        items.flatMap((item, index) =>
          term.trim() && !(isOption(item) && matchesSearch(`${item.name} ${item.keywords ?? ''}`, term)) ? [] : [index],
        ),
      [items, term],
    );
    const navigable = useMemo(
      () => shown.filter((index) => isOption(items[index] as ListSelectChoice<T> | Separator)),
      [items, shown],
    );
    const [active, setActive] = useState(() => {
      if (config.back && config.default === config.back.value) {
        return BACK_ROW;
      }

      const index = items.findIndex((item) => isOption(item) && !item.disabled && item.value === config.default);

      return index === -1 ? (navigable[0] ?? BACK_ROW) : index;
    });
    const activeItem = active < 0 ? undefined : (items[active] as ListSelectChoice<T> | undefined);

    useKeypress((key, rl) => {
      if (isEnterKey(key)) {
        if (active === BACK_ROW && config.back) {
          setStatus('done');
          done(config.back.value);
        } else if (activeItem && !activeItem.disabled) {
          setStatus('done');
          done(activeItem.value);
        }
      } else if (isUpKey(key) || isDownKey(key)) {
        // Las flechas no escriben: readline las tomaria como historial y borraria lo escrito.
        rl.clearLine(0);
        rl.write(term);

        // Las filas que se recorren con las flechas, con "Volver" al final.
        const order = config.back ? [...navigable, BACK_ROW] : navigable;
        const next = order[order.indexOf(active) + (isUpKey(key) ? -1 : 1)];

        if (next !== undefined) {
          setActive(next);
        }
      } else if (rl.line !== term) {
        // Escribir (o borrar) filtra, y marca la primera que coincide y se puede elegir.
        const nextTerm = rl.line;
        const matches = items.flatMap((item, index) =>
          isOption(item) && matchesSearch(`${item.name} ${item.keywords ?? ''}`, nextTerm) ? [index] : [],
        );
        const first = matches.find((index) => !(items[index] as ListSelectChoice<T>).disabled) ?? matches[0];

        setTerm(nextTerm);
        // Si sigue a la vista, la marcada no cambia al borrar lo escrito.
        setActive(nextTerm.trim() === '' && active >= 0 ? active : (first ?? NO_ROW));
      }
    });

    const message = theme.style.message(config.message, status);

    if (status === 'done') {
      const answer = activeItem ? (activeItem.short ?? activeItem.name) : (config.back?.label ?? '');

      return [prefix, message, theme.style.answer(answer)].filter(Boolean).join(' ');
    }

    const filtering = term.trim() !== '';
    const pageSize = filtering ? Math.max(1, config.pageSize - FILTER_LINES) : config.pageSize;
    // Con "Volver" marcado, la pagina queda donde estaba: al final, porque se llega desde la ultima opcion.
    const anchor = active < 0 ? shown.length - 1 : Math.max(0, shown.indexOf(active));
    const page = scrollWindow(shown.length, anchor, pageSize);
    const countOptions = (from: number, to: number) =>
      shown.slice(from, to).filter((index) => isOption(items[index] as ListSelectChoice<T> | Separator)).length;
    const renderRow = (label: string, isActive: boolean) => {
      const line = `${isActive ? uiSymbol('pointer') : ' '} ${label}`;

      return isActive ? theme.style.highlight(line) : line;
    };
    const rows = shown.slice(page.start, page.end).map((index) => {
      const item = items[index] as ListSelectChoice<T> | Separator;

      if (!isOption(item)) {
        return ` ${item.separator}`;
      }

      const isActive = index === active;

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
    const head = [prefix, message].filter(Boolean).join(' ');
    // Lo escrito, como en `filterList`: en su propia linea debajo de la pregunta, con una linea en blanco antes de la lista.
    const top = filtering ? `${head}${head.endsWith('\n') ? '\n' : ' '}${filterPromptLine(term)}\n ` : head;
    const lines = [
      top,
      ...(page.scrolls ? [scrollHint('above', countOptions(0, page.start))] : []),
      ...(shown.length > 0 ? rows : [noMatchesLine(term)]),
      ...(page.scrolls ? [scrollHint('below', countOptions(page.end, shown.length))] : []),
      filterCountLine(term.trim(), countOptions(0, shown.length), items.filter(isOption).length),
      ...(config.back ? [' ', renderRow(config.back.label, active === BACK_ROW)] : []),
      ' ',
      activeItem?.description ? theme.style.description(activeItem.description) : '',
      help,
    ];

    return `${lines.filter(Boolean).join('\n').trimEnd()}${CURSOR_HIDE}`;
  },
);
