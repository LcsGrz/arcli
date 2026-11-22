import { createPrompt, isEnterKey, makeTheme, useKeypress, useMemo, usePrefix, useState } from '@inquirer/core';

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
  readonly value: T;
}

export interface FilterListConfig<T> {
  /** "← Volver" fijo debajo de la lista, separado por una linea en blanco; elegirlo cierra la lista sin respuesta. */
  readonly back?: string;
  readonly default?: T;
  /** Fila de encabezado (CÓDIGO, DESCRIPCIÓN…), fija arriba de la lista. */
  readonly header?: string;
  /** Linea de ayuda debajo de la lista. */
  readonly help?: string;
  readonly message: string;
  /** `elegir`: Enter devuelve la fila marcada. `ver`: la lista es para mirar, y Enter la cierra igual que Esc. */
  readonly mode: 'elegir' | 'ver';
  readonly pageSize: number;
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

/** Las filas que contienen lo escrito, en la fila o en sus palabras clave. */
export function filterRows<T>(rows: ReadonlyArray<FilterListRow<T>>, term: string): Array<FilterListRow<T>> {
  return rows.filter((row) => matchesSearch(`${row.label} ${row.keywords ?? ''}`, term));
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

/**
 * Lista que se filtra escribiendo y se desplaza con las flechas, con un encabezado fijo arriba. Para las tablas de
 * ARCA que no entran en una pagina y para elegir una moneda. @inquirer/search no viene con ARCLI y no deja poner
 * el encabezado, asi que se arma sobre @inquirer/core, como la seleccion multiple.
 */
export const filterList = createPrompt(<T>(config: FilterListConfig<T>, done: (value: T | undefined) => void) => {
  const theme = makeTheme<FilterListStyle>(config.theme);
  const [status, setStatus] = useState<'done' | 'idle'>('idle');
  const [term, setTerm] = useState('');
  const { active, move, setActive } = useListCursor(() =>
    Math.max(
      0,
      config.rows.findIndex((row) => row.value === config.default),
    ),
  );
  const prefix = usePrefix({ status, theme });
  const visible = useMemo(() => filterRows(config.rows, term), [config.rows, term]);

  useKeypress((key, rl) => {
    if (isEnterKey(key)) {
      const row = active === BACK_ROW ? undefined : visible[active];

      if (config.mode === 'ver' || active === BACK_ROW) {
        setStatus('done');
        done(undefined);
      } else if (row) {
        setStatus('done');
        done(row.value);
      } else {
        // Enter sin nada que elegir: readline ya vacio la linea, y lo escrito tiene que seguir para editarlo.
        rl.write(term);
      }
    } else if (isCursorKey(key)) {
      // Las flechas no escriben: readline las tomaria como historial y borraria el filtro.
      rl.clearLine(0);
      rl.write(term);
      // Las filas que se recorren con las flechas, con "Volver" al final.
      move(key, [...visible.keys(), ...(config.back ? [BACK_ROW] : [])]);
    } else if (rl.line !== term) {
      setTerm(rl.line);
      setActive(0);
    }
  });

  // Con "Volver" marcado, la pagina queda al final, porque se llega desde la ultima fila.
  const window = scrollWindow(visible.length, active === BACK_ROW ? visible.length - 1 : active, config.pageSize);
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

  const count = filterCountLine(term, visible.length, config.rows.length);
  const body = visible.length > 0 ? page : noMatchesLine(term);
  const keys: HelpKey[] = [
    ['↑↓', 'navigate'],
    ...(config.mode === 'elegir' ? [['⏎', 'select'] as HelpKey] : []),
    FILTER_HELP_KEY,
  ];
  const lines = [
    // Una linea en blanco entre "Filtrar:" y la lista, y otra arriba (en `top`), para que el filtro no quede pegado.
    ' ',
    config.header ? `  ${bold(config.header)}` : '',
    body,
    count,
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
