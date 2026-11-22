import {
  createPrompt,
  isEnterKey,
  makeTheme,
  Separator,
  useEffect,
  useKeypress,
  useMemo,
  usePrefix,
  useState,
} from '@inquirer/core';

import { colorize, pointerRow, scrollHint, scrollWindow } from '../../ui';

import {
  FILTER_HELP_KEY,
  filterCountLine,
  filterPromptLine,
  matchesSearch,
  noMatchesLine,
  sameSearch,
  searchWords,
} from './filter-list';
import { isCursorKey, useListCursor } from './list-cursor';

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

/** Lo escrito y la opcion marcada (`undefined` si lo escrito no deja ninguna). */
export interface ListSelectState<V> {
  readonly term: string;
  readonly value: V | undefined;
}

/**
 * Un separador que se sigue viendo mientras se filtra, como "Cargando…": los demas (lineas en blanco, reglas) se
 * ocultan junto con las opciones que no coinciden.
 */
export class PinnedSeparator extends Separator {}

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
  /** `false`: escribir no filtra ni hace nada, como al confirmar (`confirm`). Por defecto filtra. */
  readonly filter?: boolean;
  /** Lo escrito con que arranca, al redibujar la misma lista (por ejemplo, cuando termina una carga). */
  readonly initialTerm?: string;
  readonly message: string;
  /** Lo escrito y la marcada despues de cada tecla, para redibujar la lista igual (con `initialTerm` y `default`). */
  readonly onChange?: (state: ListSelectState<B | T>) => void;
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
/**
 * Las lineas que suma el filtro: "Filtrar:", su linea en blanco y "3 de 37" (como `FILTER_LIST_EXTRA_LINES`, sin el
 * encabezado, que esta lista no tiene).
 */
const FILTER_LINES = 3;
/** Los avisos "↑ 3 más" y "↓ 12 más". */
const SCROLL_HINT_LINES = 2;

function isOption<T>(item: ListSelectChoice<T> | Separator): item is ListSelectChoice<T> {
  return !Separator.isSeparator(item);
}

/** Si la opcion coincide con lo escrito, por su nombre o sus `keywords`. */
function choiceMatches<T>(item: ListSelectChoice<T> | Separator, term: string): item is ListSelectChoice<T> {
  return isOption(item) && matchesSearch(`${item.name} ${item.keywords ?? ''}`, term);
}

/**
 * Las filas de la parte que se desplaza. Sin filtro, `pageSize`. Con filtro, en una lista que entra entera, igual
 * (lo filtrado entra). En una que se desplaza, el lugar es `pageSize` mas los dos avisos: lo filtrado va sin
 * desplazarse si entra junto con las lineas del filtro y, si no, la pagina les deja lugar para que "Volver" no se vaya
 * de la pantalla.
 */
function filteredPageSize(pageSize: number, total: number, shown: number, filtering: boolean): number {
  if (!filtering || total <= pageSize) {
    return pageSize;
  }

  const room = pageSize + SCROLL_HINT_LINES;

  return shown + FILTER_LINES <= room ? shown : Math.max(1, room - FILTER_LINES - SCROLL_HINT_LINES);
}

/**
 * Lista para elegir una opcion, como @inquirer/select, pero con "Volver" fijo debajo de la parte que se desplaza y
 * con un aviso de las opciones que no se ven ("↑ 3 más", "↓ 12 más"). En @inquirer/select "Volver" era una opcion
 * mas y se iba de la pantalla con el resto.
 *
 * Escribir filtra las opciones con la misma busqueda que `filterList` (`matchesSearch`: sin tildes, por palabras y por
 * `keywords`). Lo escrito se ve en "Filtrar:" y queda hasta que se borra con Backspace; sin nada escrito, la lista se
 * ve como siempre. Con `filter: false`, escribir no hace nada.
 */
export const listSelect = createPrompt(
  <T, B = never>(config: ListSelectConfig<T, B>, done: (value: B | T) => void): string => {
    const theme = makeTheme<ListSelectStyle>(config.theme);
    const filterable = config.filter !== false;
    const [status, setStatus] = useState<'done' | 'idle'>('idle');
    const [term, setTerm] = useState(filterable ? (config.initialTerm ?? '') : '');
    const prefix = usePrefix({ status, theme });
    const items = config.choices;
    const filtering = searchWords(term).length > 0;
    // Con algo escrito, las opciones que coinciden y los separadores fijos; las posiciones son las de `items`.
    const shown = useMemo(
      () =>
        items.flatMap((item, index) =>
          !filtering || choiceMatches(item, term) || item instanceof PinnedSeparator ? [index] : [],
        ),
      [items, term, filtering],
    );
    const navigable = useMemo(
      () => shown.filter((index) => isOption(items[index] as ListSelectChoice<T> | Separator)),
      [items, shown],
    );
    const { active, move, setActive } = useListCursor(() => {
      if (config.back && config.default === config.back.value) {
        return BACK_ROW;
      }

      const index = items.findIndex(
        (item, position) =>
          isOption(item) && !item.disabled && item.value === config.default && navigable.includes(position),
      );

      return index === -1 ? (navigable[0] ?? (filtering ? NO_ROW : BACK_ROW)) : index;
    });
    const activeItem = active < 0 ? undefined : (items[active] as ListSelectChoice<T> | undefined);

    // Lo escrito con que arranca va a la linea de readline, para seguir editandolo.
    useEffect((rl) => {
      if (term) {
        rl.write(term);
      }
    }, []);

    const report = (nextTerm: string, row: number) => {
      const value =
        row === BACK_ROW
          ? config.back?.value
          : row === NO_ROW
            ? undefined
            : (items[row] as ListSelectChoice<T> | undefined)?.value;

      config.onChange?.({ term: nextTerm, value });
    };

    useKeypress((key, rl) => {
      if (isEnterKey(key)) {
        if (active === BACK_ROW && config.back) {
          setStatus('done');
          done(config.back.value);
        } else if (activeItem && !activeItem.disabled) {
          setStatus('done');
          done(activeItem.value);
        } else {
          // Enter sin nada que elegir: readline ya vacio la linea, y lo escrito tiene que seguir para editarlo.
          rl.write(term);
        }
      } else if (isCursorKey(key)) {
        // Las flechas no escriben: readline las tomaria como historial y borraria lo escrito.
        rl.clearLine(0);
        rl.write(term);

        // Las filas que se recorren con las flechas, con "Volver" al final.
        const next = move(key, config.back ? [...navigable, BACK_ROW] : navigable);

        if (next !== undefined) {
          report(term, next);
        }
      } else if (!filterable) {
        // Sin filtro, lo que se escribe no se junta en la linea.
        rl.clearLine(0);
      } else if (rl.line !== term) {
        const nextTerm = rl.line;
        let next = active;

        if (searchWords(nextTerm).length === 0) {
          // Al borrar lo escrito, la marcada (tambien "Volver") queda donde estaba; si no habia ninguna, la primera.
          next = active === NO_ROW ? (items.findIndex(isOption) === -1 ? BACK_ROW : items.findIndex(isOption)) : active;
        } else if (!sameSearch(nextTerm, term)) {
          // Otra busqueda marca la primera que coincide y se puede elegir. Un espacio o un Tab no la mueven.
          const matches = items.flatMap((item, index) => (choiceMatches(item, nextTerm) ? [index] : []));

          next = matches.find((index) => !(items[index] as ListSelectChoice<T>).disabled) ?? matches[0] ?? NO_ROW;
        }

        setTerm(nextTerm);
        setActive(next);
        report(nextTerm, next);
      }
    });

    const message = theme.style.message(config.message, status);

    if (status === 'done') {
      const answer = activeItem ? (activeItem.short ?? activeItem.name) : (config.back?.label ?? '');

      return [prefix, message, theme.style.answer(answer)].filter(Boolean).join(' ');
    }

    const pageSize = filteredPageSize(config.pageSize, items.length, shown.length, filtering);
    // Con "Volver" marcado, la pagina queda donde estaba: al final, porque se llega desde la ultima opcion.
    const anchor = active < 0 ? shown.length - 1 : Math.max(0, shown.indexOf(active));
    const page = scrollWindow(shown.length, anchor, pageSize);
    const countOptions = (from: number, to: number) =>
      shown.slice(from, to).filter((index) => isOption(items[index] as ListSelectChoice<T> | Separator)).length;
    const rows = shown.slice(page.start, page.end).map((index) => {
      const item = items[index] as ListSelectChoice<T> | Separator;

      if (!isOption(item)) {
        return ` ${item.separator}`;
      }

      const isActive = index === active;

      if (item.disabled) {
        const label = typeof item.disabled === 'string' ? `${item.name} ${item.disabled}` : item.name;

        return colorize(pointerRow(label, isActive), 'muted');
      }

      return pointerRow(item.name, isActive, theme.style.highlight);
    });
    const help = theme.style.keysHelpTip([
      ['↑↓', 'navigate'],
      ['⏎', 'select'],
      ...(filterable ? [FILTER_HELP_KEY] : []),
    ]);
    const head = [prefix, message].filter(Boolean).join(' ');
    // Lo escrito, como en `filterList`: en su propia linea debajo de la pregunta, con una linea en blanco antes de la lista.
    const top = filtering ? `${head}${head.endsWith('\n') ? '\n' : ' '}${filterPromptLine(term)}\n ` : head;
    const lines = [
      top,
      ...(page.scrolls ? [scrollHint('above', countOptions(0, page.start))] : []),
      ...(filtering && navigable.length === 0 ? [noMatchesLine(term)] : []),
      ...rows,
      ...(page.scrolls ? [scrollHint('below', countOptions(page.end, shown.length))] : []),
      filterCountLine(term.trim(), navigable.length, items.filter(isOption).length),
      ...(config.back ? [' ', pointerRow(config.back.label, active === BACK_ROW, theme.style.highlight)] : []),
      ' ',
      activeItem?.description ? theme.style.description(activeItem.description) : '',
      help,
    ];

    return `${lines.filter(Boolean).join('\n').trimEnd()}${CURSOR_HIDE}`;
  },
);
