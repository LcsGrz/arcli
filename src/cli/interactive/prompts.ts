import input from '@inquirer/input';
import { Separator } from '@inquirer/select';
import { emitKeypressEvents } from 'node:readline';

import { BACK, type Back } from '../../modules/interactive/wizard';
import { bold, colorize, uiSymbol, usesAsciiBorders, writeTerminalRaw } from '../../ui';

import { filterList, type FilterListRow } from './filter-list';
import { listSelect } from './list-select';
import { multiSelect } from './multi-select';

export interface Choice<T> {
  readonly description?: string;
  /** Se ve apagada y no se puede elegir; con texto, ese texto va al lado. */
  readonly disabled?: boolean | string;
  readonly name: string;
  /** Lo que queda en la linea "✔ pregunta respuesta" al elegirla; por defecto, `name`. */
  readonly short?: string;
  readonly value: T;
}

type HelpKey = [key: string, action: string];

// La ayuda de teclas de @inquirer viene en ingles.
const HELP_TRANSLATIONS: Record<string, HelpKey> = {
  'a all': ['a', 'todos'],
  'i invert': ['i', 'invertir'],
  'space select': ['espacio', 'marcar'],
  '↑↓ navigate': [uiSymbol('keysMove'), 'mover'],
  '⏎ select': [uiSymbol('keyEnter'), 'elegir'],
  '⏎ submit': [uiSymbol('keyEnter'), 'confirmar'],
};

function keysHelpTip(extra: readonly HelpKey[]): (keys: HelpKey[]) => string {
  return (keys) =>
    [...keys.map(([key, action]) => HELP_TRANSLATIONS[`${key} ${action}`] ?? [key, action]), ...extra]
      .map(([key, action]) => `${bold(key)} ${colorize(action, 'muted')}`)
      .join(colorize(` ${uiSymbol('bullet')} `, 'muted'));
}

/**
 * La pregunta activa lleva dos lineas en blanco arriba, para separarla de las ya respondidas. Al responderla
 * @inquirer la redibuja con el prefijo "done", sin esas lineas, y las respuestas quedan juntas.
 */
const DONE_PREFIX = colorize(uiSymbol('done'), 'success');
const PROMPT_PREFIX = { done: DONE_PREFIX, idle: `\n\n${colorize('?', 'info')}` };
/** Una sola linea arriba: para una pregunta que ya tiene una linea en blanco fija antes, como el menu bajo la barra. */
const COMPACT_PROMPT_PREFIX = { done: DONE_PREFIX, idle: `\n${colorize('?', 'info')}` };

// Los iconos y el spinner de @inquirer son Unicode: con ARCLI_ASCII=1 se reemplazan.
const ASCII_THEME = usesAsciiBorders()
  ? {
      icon: { cursor: uiSymbol('pointer') },
      spinner: { frames: ['-', '\\', '|', '/'], interval: 80 },
    }
  : {};

/**
 * En las listas, mientras la pregunta esta activa, una linea en blanco entre la pregunta y las opciones, y otra
 * entre la descripcion de la opcion marcada y la ayuda de teclas.
 */
function listStyle(extraKeys: readonly HelpKey[]) {
  return {
    description: (text: string) => `${colorize(text, 'info')}\n`,
    keysHelpTip: keysHelpTip(extraKeys),
    message: (text: string, status: string) => (status === 'done' ? bold(text) : `${bold(text)}\n`),
  };
}

const MENU_THEME = { ...ASCII_THEME, prefix: PROMPT_PREFIX, style: listStyle([]) };
const STEP_THEME = { ...ASCII_THEME, prefix: PROMPT_PREFIX, style: listStyle([['esc', 'volver']]) };
const TEXT_THEME = {
  ...ASCII_THEME,
  prefix: PROMPT_PREFIX,
  style: { defaultAnswer: (text: string) => colorize(`enter: ${text}`, 'muted') },
};

/**
 * Una lista simple. Con `escapeValue`, Esc la cierra devolviendo ese valor (por ejemplo, "volver", "no" o
 * "salir") y la ayuda de teclas lo muestra con `escapeLabel`; sin el, Esc no hace nada. Con `back`, un boton
 * ("← Volver") fijo debajo de las opciones, que no se desplaza con ellas. Con `compactTop`, una sola linea en blanco
 * arriba en lugar de dos.
 */
export async function chooseOne<T>(
  message: string,
  choices: ReadonlyArray<Choice<T> | Separator>,
  defaultValue?: T,
  options: {
    readonly back?: { readonly label: string; readonly value: T };
    readonly compactTop?: boolean;
    readonly escapeLabel?: string;
    readonly escapeValue?: T;
  } = {},
): Promise<T> {
  const { back, compactTop = false, escapeLabel = 'volver', escapeValue } = options;
  const prefix = compactTop ? COMPACT_PROMPT_PREFIX : PROMPT_PREFIX;
  const config = {
    back,
    choices,
    default: defaultValue,
    message,
    pageSize: MIN_PAGE_SIZE,
    theme:
      escapeValue === undefined
        ? { ...MENU_THEME, prefix }
        : { ...ASCII_THEME, prefix, style: listStyle([['esc', escapeLabel] as HelpKey]) },
  };

  if (escapeValue === undefined) {
    return listSelect<T, T>(config);
  }

  const result = await runStepPrompt(
    (context) => listSelect<T, T>(config, context),
    (answer) => ({ answer: back && answer === back.value ? back.label : choiceName(choices, answer), message }),
  );

  return 'answer' in result && result.answer !== BACK ? result.answer : escapeValue;
}

export async function askText(
  message: string,
  options: { readonly defaultValue?: string; readonly validate?: (value: string) => string | true } = {},
): Promise<string> {
  const answer = await input({
    default: options.defaultValue,
    message,
    theme: TEXT_THEME,
    validate: options.validate,
  });

  return answer.trim();
}

/** Si o no; Esc cuenta como no. */
export async function confirm(message: string, yesLabel: string, noLabel = 'Cancelar'): Promise<boolean> {
  return chooseOne(
    message,
    [
      { name: yesLabel, value: true },
      { name: noLabel, value: false },
    ],
    undefined,
    { escapeValue: false },
  );
}

/** Ctrl+C dentro de un prompt de @inquirer. */
export function isPromptCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === 'ExitPromptError';
}

// Lineas que ocupa el prompt fuera de la lista: linea en blanco, pregunta, descripcion y ayuda de teclas.
const PROMPT_CHROME_LINES = 6;
// "← Volver" y la linea en blanco que lo separa de las opciones, fijos debajo de la lista.
const BACK_LINES = 2;
// Los avisos "↑ 3 más" y "↓ 12 más" de una lista que se desplaza.
const SCROLL_HINT_LINES = 2;
const MIN_PAGE_SIZE = 12;
const MIN_SCROLL_PAGE_SIZE = 3;

/**
 * Alto de la parte que se desplaza para `count` filas: todas si entran en la terminal (junto con "Volver", salvo con
 * `back: false`), si no las que entren con los avisos de arriba y abajo. `extraLines`: lo que el prompt suma fuera de
 * la lista, como el filtro y el encabezado de una lista que se filtra.
 */
export function fitPageSize(
  count: number,
  options: { readonly back?: boolean; readonly extraLines?: number } = {},
): number {
  const available =
    (process.stdout.rows || 24) -
    PROMPT_CHROME_LINES -
    (options.extraLines ?? 0) -
    (options.back === false ? 0 : BACK_LINES);

  // Si no entra, la pagina se achica a lo que entra (con un minimo chico), asi "Volver" no queda fuera de la pantalla.
  return count <= available
    ? Math.max(MIN_PAGE_SIZE, count)
    : Math.max(MIN_SCROLL_PAGE_SIZE, available - SCROLL_HINT_LINES);
}

/** "← Volver" al final de una lista, fijo debajo de las opciones aunque la lista se desplace. */
export const BACK_CHOICE = { name: `${uiSymbol('back')} Volver`, value: BACK } as const;
// Alternativa a Esc, por si la terminal no la manda.
const BACK_TEXT = '<';
const ESCAPE_REASON = 'esc';

/** La misma linea que deja @inquirer al responder; hace falta cuando el prompt se borra al cerrarse. */
function writeAnsweredLine(message: string, answer: string): void {
  writeTerminalRaw(`${DONE_PREFIX} ${bold(message)} ${colorize(answer, 'info')}\n`);
}

/**
 * Corre un prompt de paso que se cierra con Esc (vuelve al paso anterior) o cuando se aborta `signal`.
 * El prompt se borra al cerrarse, asi una pregunta abandonada no queda en pantalla; si se respondio,
 * se escribe la linea "✔ pregunta respuesta" igual que siempre.
 */
async function runStepPrompt<T>(
  run: (context: { clearPromptOnDone: boolean; signal: AbortSignal }) => Promise<T>,
  /** Sin linea (`undefined`), el prompt se borra y no deja rastro, como una lista que solo se mira. */
  answeredLine: (answer: T) => { readonly answer: string; readonly message: string } | undefined,
  signal?: AbortSignal,
): Promise<{ readonly aborted: true } | { readonly answer: Back | T }> {
  const controller = new AbortController();
  const onKeypress = (_text: string, key?: { readonly name?: string }) => {
    if (key?.name === 'escape') {
      controller.abort(ESCAPE_REASON);
    }
  };
  const onAbort = () => controller.abort(signal?.reason);

  signal?.addEventListener('abort', onAbort);
  // @inquirer ya emite keypress sobre stdin; llamarlo de nuevo no hace nada.
  emitKeypressEvents(process.stdin);
  process.stdin.on('keypress', onKeypress);

  try {
    const answer = await run({ clearPromptOnDone: true, signal: controller.signal });
    const line = answeredLine(answer);

    if (line) {
      writeAnsweredLine(line.message, line.answer);
    }

    return { answer };
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortPromptError')) {
      throw error;
    }

    return controller.signal.reason === ESCAPE_REASON ? { answer: BACK } : { aborted: true };
  } finally {
    process.stdin.off('keypress', onKeypress);
    signal?.removeEventListener('abort', onAbort);
  }
}

function choiceName<T>(choices: ReadonlyArray<Choice<T> | Separator>, answer: Back | T): string {
  if (answer === BACK) {
    return BACK_CHOICE.name;
  }

  const chosen = choices.find((item): item is Choice<T> => !Separator.isSeparator(item) && item.value === answer);

  return chosen?.short ?? chosen?.name ?? '';
}

async function selectStep<T>(
  message: string,
  choices: ReadonlyArray<Choice<T> | Separator>,
  defaultValue: T | undefined,
  pageSize: number,
  signal?: AbortSignal,
) {
  return runStepPrompt(
    (context) =>
      listSelect<T, Back>(
        {
          back: { label: BACK_CHOICE.name, value: BACK },
          choices,
          default: defaultValue,
          message,
          pageSize,
          theme: STEP_THEME,
        },
        context,
      ),
    (answer) => ({ answer: choiceName(choices, answer), message }),
    signal,
  );
}

/**
 * Como chooseOne, con una opcion "← Volver" al final para el motor de pasos (Esc hace lo mismo).
 * Acepta separadores entre opciones.
 */
export async function chooseStep<T>(
  message: string,
  choices: ReadonlyArray<Choice<T> | Separator>,
  defaultValue?: T,
  pageSize = 12,
): Promise<Back | T> {
  const result = await selectStep(message, choices, defaultValue, pageSize);

  // Sin signal externo, solo Esc aborta, y eso ya vuelve como BACK.
  return 'answer' in result ? result.answer : BACK;
}

/** Borra la linea de la ultima respuesta ("✔ pregunta respuesta"), para redibujar la misma lista en su lugar. */
export function eraseLastAnswer(): void {
  if (process.stdout.isTTY) {
    process.stdout.write('\u001B[1A\u001B[2K\r');
  }
}

export type LoadingResult<T, L> = { readonly answer: Back | T } | { readonly loaded: L };

/**
 * Muestra la lista mientras `loading` esta en curso (por ejemplo, con "Cargando…" en lugar de un boton).
 * Si termina la carga, la lista desaparece sin dejar rastro y devuelve lo cargado; si antes se elige
 * una opcion (o Esc), devuelve esa respuesta.
 */
export async function chooseStepWhileLoading<T, L>(
  message: string,
  choices: ReadonlyArray<Choice<T> | Separator>,
  defaultValue: T | undefined,
  pageSize: number,
  loading: Promise<L>,
): Promise<LoadingResult<T, L>> {
  const loaded = new AbortController();
  const stop = () => loaded.abort();

  loading.then(stop, stop);

  const result = await selectStep(message, choices, defaultValue, pageSize, loaded.signal);

  return 'answer' in result ? result : { loaded: await loading };
}

/** Como askText, pero Esc (o escribir "<") vuelve al paso anterior. */
export async function askTextStep(
  message: string,
  options: { readonly defaultValue?: string; readonly validate?: (value: string) => string | true } = {},
): Promise<Back | string> {
  const result = await runStepPrompt(
    (context) =>
      input(
        {
          default: options.defaultValue,
          message: `${message} ${colorize('([esc] para volver)', 'muted')}`,
          theme: TEXT_THEME,
          validate: (value) => (value.trim() === BACK_TEXT ? true : (options.validate?.(value) ?? true)),
        },
        context,
      ),
    (answer) => ({ answer: answer.trim(), message }),
  );

  if (!('answer' in result) || result.answer === BACK) {
    return BACK;
  }

  const answer = result.answer.trim();

  return answer === BACK_TEXT ? BACK : answer;
}

/**
 * Seleccion multiple: espacio marca, Enter confirma (sin marcar nada tambien vale). Tiene un boton "← Volver" al
 * final para el motor de pasos: Enter sobre el (o Esc) vuelve al paso anterior.
 */
export async function chooseManyStep<T>(
  message: string,
  choices: ReadonlyArray<Choice<T>>,
  selected: readonly T[] = [],
): Promise<Back | T[]> {
  const result = await runStepPrompt(
    (context) =>
      multiSelect<T>(
        { backLabel: BACK_CHOICE.name, choices, message, pageSize: 12, selected, theme: STEP_THEME },
        context,
      ),
    (answer) => ({
      answer:
        answer === BACK
          ? BACK_CHOICE.name
          : choices
              .filter((choice) => answer.includes(choice.value))
              .map((choice) => choice.name)
              .join(', '),
      message,
    }),
  );

  return 'answer' in result ? result.answer : BACK;
}

export type { FilterListRow } from './filter-list';

interface FilterListOptions<T> {
  readonly defaultValue?: T;
  readonly header?: string;
  readonly help?: string;
  readonly pageSize: number;
}

/** Lineas que una lista que se filtra suma a las de cualquier lista: "Filtrar:", su linea en blanco, encabezado y cuenta. */
export const FILTER_LIST_EXTRA_LINES = 4;

/**
 * Elegir de una lista que se filtra escribiendo (por ejemplo "eur" o "060" para el euro) y se desplaza con las
 * flechas. Esc vuelve al paso anterior.
 */
export async function chooseFromFilterList<T>(
  message: string,
  rows: ReadonlyArray<FilterListRow<T>>,
  options: FilterListOptions<T>,
): Promise<Back | T> {
  const result = await runStepPrompt(
    (context) =>
      filterList<T>(
        {
          back: BACK_CHOICE.name,
          default: options.defaultValue,
          header: options.header,
          help: options.help,
          message,
          mode: 'elegir',
          pageSize: options.pageSize,
          rows,
          theme: STEP_THEME,
        },
        context,
      ),
    (answer) => {
      if (answer === undefined) {
        return { answer: BACK_CHOICE.name, message };
      }

      const row = rows.find((item) => item.value === answer);

      return { answer: row?.short ?? row?.label.replace(/\s+/g, ' ').trim() ?? '', message };
    },
  );

  if (!('answer' in result) || result.answer === BACK || result.answer === undefined) {
    return BACK;
  }

  return result.answer;
}

/** Una tabla larga para mirar: se filtra escribiendo y se desplaza con las flechas. Enter o Esc la cierran. */
export async function browseFilterList(
  message: string,
  rows: readonly string[],
  options: Omit<FilterListOptions<string>, 'defaultValue'>,
): Promise<void> {
  await runStepPrompt(
    (context) =>
      filterList<string>(
        {
          back: BACK_CHOICE.name,
          header: options.header,
          help: options.help,
          message,
          mode: 'ver',
          pageSize: options.pageSize,
          rows: rows.map((label) => ({ label, value: label })),
          theme: STEP_THEME,
        },
        context,
      ),
    () => undefined,
  );
}
