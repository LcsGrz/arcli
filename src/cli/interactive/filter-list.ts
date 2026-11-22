import {
  createPrompt,
  isEnterKey,
  makeTheme,
  useEffect,
  useKeypress,
  useMemo,
  usePrefix,
  useState,
} from '@inquirer/core';

import { bold, colorize, pointerRow, scrollHint, scrollWindow, stripAnsi } from '../../ui';

import { isCursorKey, useListCursor } from './list-cursor';

type HelpKey = [string, string];

export interface FilterListRow<T> {
  /** La fila como se ve, ya alineada con el encabezado. */
  readonly label: string;
  /** Lo que se compara con lo escrito, ademas de la fila: por ejemplo, el codigo ISO de una moneda. */
  readonly keywords?: string;
  /** Lo que queda en la linea "✔ pregunta respuesta" al elegirla; por defecto, la fila. */
  readonly short?: string;
  /** Se ve solo con el filtro vacio y no se busca, como la fila de "sin valor" de `chooseOrTypeStep`. */
  readonly unfilteredOnly?: boolean;
  readonly value: T;
}

/**
 * Usar lo escrito en lugar de una fila (`chooseOrTypeStep`): con algo escrito que no es exactamente una fila, la lista
 * suma debajo de las que coinciden una fila "Usar lo escrito: …". Enter sobre ella valida lo escrito y, si vale, cierra
 * con `value(lo escrito)`; si no, muestra el error y sigue.
 */
interface FilterListTyped<T> {
  /** La fila de lo escrito, por ejemplo "Usar lo escrito: Mercado Pago". */
  readonly label: (term: string) => string;
  readonly validate?: (term: string) => string | true;
  readonly value: (term: string) => T;
}

export interface FilterListConfig<T> {
  /** "← Volver" fijo debajo de la lista, separado por una linea en blanco; elegirlo cierra la lista sin respuesta. */
  readonly back?: string;
  readonly default?: T;
  /** Fila de encabezado (CÓDIGO, DESCRIPCIÓN…), fija arriba de la lista. */
  readonly header?: string;
  /** Linea de ayuda debajo de la lista. */
  readonly help?: string;
  /** Lo escrito con que arranca, por ejemplo una respuesta anterior que no es una fila (con `typed`, la marca). */
  readonly initialTerm?: string;
  readonly message: string;
  /** `elegir`: Enter devuelve la fila marcada. `ver`: la lista es para mirar, y Enter la cierra igual que Esc. */
  readonly mode: 'elegir' | 'ver';
  readonly pageSize: number;
  /**
   * Sin una fila por defecto razonable (un dato fiscal): sin `default`, arranca sin fila marcada y Enter con el filtro
   * vacio muestra este error en lugar de elegir la primera.
   */
  readonly requireChoice?: string;
  readonly rows: ReadonlyArray<FilterListRow<T>>;
  readonly theme: {
    readonly prefix?: { readonly done: string; readonly idle: string };
    readonly spinner?: { readonly frames: string[]; readonly interval: number };
    readonly style: {
      readonly description: (text: string) => string;
      readonly keysHelpTip: (keys: HelpKey[]) => string;
      readonly message?: (text: string, status: string) => string;
    };
  };
  readonly typed?: FilterListTyped<T>;
}

interface FilterListStyle {
  readonly style: FilterListConfig<unknown>['theme']['style'];
}

/** Sin mayusculas ni tildes: "dolar" encuentra "Dólar" y "eur", "EURO". */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Las palabras de lo escrito, sin mayusculas ni tildes: dos textos con las mismas filtran igual. */
export function searchWords(term: string): string[] {
  return normalize(term).split(/\s+/).filter(Boolean);
}

/**
 * Si `text` tiene cada palabra de lo escrito, en cualquier orden, sin mayusculas ni tildes: "dolar canad" encuentra
 * "Dólares canadienses (CAD)". Sin nada escrito, todo coincide. Los colores de `text` (un "(nuevo)" resaltado) no
 * cuentan. Es la unica manera de buscar del asistente: la usan las listas que se filtran (`filterList`) y las de
 * opciones (`listSelect`).
 */
export function matchesSearch(text: string, term: string): boolean {
  const haystack = normalize(stripAnsi(text));

  return searchWords(term).every((word) => haystack.includes(word));
}

/** Si dos textos buscan lo mismo: sin mayusculas ni tildes, y un espacio o un Tab de mas no cambian la busqueda. */
export function sameSearch(left: string, right: string): boolean {
  return searchWords(left).join(' ') === searchWords(right).join(' ');
}

/** Si lo escrito es exactamente una fila: su texto, lo que deja al elegirla o sus palabras clave. */
function isExactRow<T>(row: FilterListRow<T>, term: string): boolean {
  return [row.label, row.short, row.keywords].some((text) => text !== undefined && sameSearch(stripAnsi(text), term));
}

/**
 * La fila que se marca al escribir: la que es exactamente lo escrito (con "niger", NIGER aunque NIGERIA vaya antes,
 * como `--pais-destino niger`) o, si ninguna, la primera que coincide.
 */
function firstMatch<T>(visible: ReadonlyArray<FilterListRow<T>>, term: string): number {
  return Math.max(
    0,
    visible.findIndex((row) => isExactRow(row, term)),
  );
}

/** Las filas que contienen lo escrito, en la fila o en sus palabras clave. */
export function filterRows<T>(rows: ReadonlyArray<FilterListRow<T>>, term: string): Array<FilterListRow<T>> {
  const filtering = searchWords(term).length > 0;

  return rows.filter(
    (row) => !(filtering && row.unfilteredOnly) && matchesSearch(`${row.label} ${row.keywords ?? ''}`, term),
  );
}

/** La pista de que se puede escribir para filtrar, en la ayuda de teclas de las listas que filtran. */
export const FILTER_HELP_KEY: [string, string] = ['escribí', 'para filtrar'];

/** "Filtrar: dol", la linea con lo escrito. */
export function filterPromptLine(term: string): string {
  return `${colorize('Filtrar:', 'muted')} ${term}`;
}

/** "  3 de 37", cuando lo escrito deja menos filas que todas; si no, vacio (sin ninguna, ya lo dice `noMatchesLine`). */
export function filterCountLine(term: string, shown: number, total: number): string {
  return term && shown > 0 && shown < total ? colorize(`  ${shown} de ${total}`, 'muted') : '';
}

/** "  Nada coincide con "zzz".", en lugar de la lista vacia. */
export function noMatchesLine(term: string): string {
  return colorize(`  Nada coincide con "${term.trim()}".`, 'muted');
}

/** La posicion de "Volver": despues de la ultima fila. */
const BACK_ROW = -1;
/** Ninguna marcada (`requireChoice` con el filtro vacio): Enter muestra el error y ↓ marca la primera. */
const NO_ROW = -2;

/**
 * Lista que se filtra escribiendo y se desplaza con las flechas, con un encabezado fijo arriba. Para las tablas de
 * ARCA que no entran en una pagina y para elegir una moneda. @inquirer/search no viene con ARCLI y no deja poner
 * el encabezado, asi que se arma sobre @inquirer/core, como la seleccion multiple.
 */
export const filterList = createPrompt(<T>(config: FilterListConfig<T>, done: (value: T | undefined) => void) => {
  const theme = makeTheme<FilterListStyle>(config.theme);
  const [status, setStatus] = useState<'done' | 'idle'>('idle');
  const [term, setTerm] = useState(config.initialTerm ?? '');
  // El error de lo escrito ("Usar lo escrito" que no valida), hasta la proxima tecla.
  const [error, setError] = useState<string | undefined>(undefined);
  const prefix = usePrefix({ status, theme });
  const visible = useMemo(() => filterRows(config.rows, term), [config.rows, term]);
  // La fila de lo escrito va despues de las que coinciden: Enter sigue eligiendo la primera que coincide.
  const typedIndex =
    config.typed && searchWords(term).length > 0 && !visible.some((row) => isExactRow(row, term))
      ? visible.length
      : undefined;
  const { active, move, setActive } = useListCursor(() => {
    if (config.initialTerm) {
      // Lo escrito con que arranca no es una fila: arranca marcada la de lo escrito.
      return typedIndex ?? firstMatch(visible, config.initialTerm);
    }

    const marked = visible.findIndex((row) => row.value === config.default);

    return marked === -1 && config.requireChoice ? NO_ROW : Math.max(0, marked);
  });

  // Lo escrito con que arranca va a la linea de readline, para seguir editandolo.
  useEffect((rl) => {
    if (term) {
      rl.write(term);
    }
  }, []);

  useKeypress((key, rl) => {
    setError(undefined);

    if (isEnterKey(key)) {
      const row = active === BACK_ROW ? undefined : visible[active];

      if (config.mode === 'ver' || active === BACK_ROW) {
        setStatus('done');
        done(undefined);
      } else if (row) {
        setStatus('done');
        done(row.value);
      } else if (active === NO_ROW && config.requireChoice) {
        setError(config.requireChoice);
        rl.write(term);
      } else if (config.typed && active === typedIndex) {
        const valid = config.typed.validate?.(term) ?? true;

        if (valid === true) {
          setStatus('done');
          done(config.typed.value(term));
        } else {
          setError(valid);
          rl.write(term);
        }
      } else {
        // Enter sin nada que elegir: readline ya vacio la linea, y lo escrito tiene que seguir para editarlo.
        rl.write(term);
      }
    } else if (isCursorKey(key)) {
      // Las flechas no escriben: readline las tomaria como historial y borraria el filtro.
      rl.clearLine(0);
      rl.write(term);
      // Las filas que se recorren con las flechas, con lo escrito y "Volver" al final.
      move(key, [
        ...visible.keys(),
        ...(typedIndex === undefined ? [] : [typedIndex]),
        ...(config.back ? [BACK_ROW] : []),
      ]);
    } else if (rl.line !== term) {
      setTerm(rl.line);
      setActive(
        config.requireChoice && searchWords(rl.line).length === 0
          ? NO_ROW
          : firstMatch(filterRows(config.rows, rl.line), rl.line),
      );
    }
  });

  // Con lo escrito o "Volver" marcado, la pagina queda al final, porque se llega desde la ultima fila.
  const anchor = active === NO_ROW ? 0 : active === BACK_ROW || active === typedIndex ? visible.length - 1 : active;
  const window = scrollWindow(visible.length, anchor, config.pageSize);
  const page = [
    ...(window.scrolls ? [scrollHint('above', window.start)] : []),
    ...visible
      .slice(window.start, window.end)
      .map((item, offset) => pointerRow(item.label, window.start + offset === active, theme.style.highlight)),
    ...(window.scrolls ? [scrollHint('below', visible.length - window.end)] : []),
  ].join('\n');
  const message = theme.style.message(config.message, status);

  if (status === 'done') {
    return [prefix, message].filter(Boolean).join(' ');
  }

  const count = filterCountLine(term, visible.length, config.rows.filter((row) => !row.unfilteredOnly).length);
  const typedRow =
    config.typed && typedIndex !== undefined
      ? pointerRow(config.typed.label(term.trim()), active === typedIndex, theme.style.highlight)
      : '';
  // Sin filas que coincidan, la de lo escrito ocupa el lugar de "Nada coincide".
  const body = visible.length > 0 ? [page, typedRow].filter(Boolean).join('\n') : typedRow || noMatchesLine(term);
  const keys: HelpKey[] = [
    ['↑↓', 'navigate'],
    ...(config.mode === 'elegir' ? [['⏎', 'select'] as HelpKey] : []),
    // Donde tambien se usa lo escrito, la ayuda lo dice.
    config.typed ? ['escribí', 'para filtrar o usar otro'] : FILTER_HELP_KEY,
  ];
  const lines = [
    // Una linea en blanco entre "Filtrar:" y la lista, y otra arriba (en `top`), para que el filtro no quede pegado.
    ' ',
    config.header ? `  ${bold(config.header)}` : '',
    body,
    count,
    error ? colorize(`> ${error}`, 'danger') : '',
    ...(config.back ? [' ', pointerRow(config.back, active === BACK_ROW, theme.style.highlight)] : []),
    ' ',
    config.help ? theme.style.description(config.help) : '',
    theme.style.keysHelpTip(keys),
  ];
  // Con dos partes, el cursor queda despues de lo escrito y la lista va debajo. El mensaje activo termina en un salto
  // de linea (el estilo de las listas), asi que el filtro queda en su propia linea.
  const head = [prefix, message].filter(Boolean).join(' ');
  const top = `${head}${head.endsWith('\n') ? '\n' : ' '}${filterPromptLine(term)}`;

  return [top, lines.filter(Boolean).join('\n').trimEnd()];
});
