import input from '@inquirer/input';
import { Separator } from '@inquirer/select';
import { emitKeypressEvents } from 'node:readline';

import type { RowEdits } from '../../modules/interactive/row-marks';
import { BACK, type Back } from '../../modules/interactive/wizard';
import { bold, colorize, type RowActionsListRow, uiSymbol, usesAsciiBorders, writeTerminalRaw } from '../../ui';

import { blockPager } from './block-pager';
import { filterList, type FilterListRow } from './filter-list';
import { listSelect, type ListSelectState } from './list-select';
import { multiSelect } from './multi-select';
import { rowActionsList } from './row-actions-list';
import { SKIP_HINT, SKIP_ROW } from './text-hints';

export interface Choice<T> {
  readonly description?: string;
  /** Se ve apagada y no se puede elegir; con texto, ese texto va al lado. */
  readonly disabled?: boolean | string;
  /** Lo que se compara con lo escrito para filtrar, ademas del nombre: por ejemplo, el codigo de ARCA de una moneda. */
  readonly keywords?: string;
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
 * arriba en lugar de dos. Con `filter: false`, escribir no filtra (como al confirmar).
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
    readonly filter?: boolean;
  } = {},
): Promise<T> {
  const { back, compactTop = false, escapeLabel = 'volver', escapeValue, filter } = options;
  const prefix = compactTop ? COMPACT_PROMPT_PREFIX : PROMPT_PREFIX;
  const config = {
    back,
    choices,
    default: defaultValue,
    filter,
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

/**
 * La aclaracion de una pregunta de texto ("(Enter para omitirlo)") va antes de los dos puntos, y solo mientras se
 * responde: en la linea "✔ pregunta respuesta" queda la pregunta sola, asi un Enter vacio se ve vacio (TUI-19).
 */
function withHint(message: string, hint: string | undefined): string {
  if (!hint) {
    return message;
  }

  return message.endsWith(':') ? `${message.slice(0, -1)} ${hint}:` : `${message} ${hint}`;
}

export async function askText(
  message: string,
  options: {
    readonly defaultValue?: string;
    /** Ver `TextStepOptions.hint`. */
    readonly hint?: string;
    readonly validate?: (value: string) => string | true;
  } = {},
): Promise<string> {
  const answer = await input(
    {
      default: options.defaultValue,
      message: withHint(message, options.hint),
      theme: TEXT_THEME,
      validate: options.validate,
    },
    // Con aclaracion, la linea de la respuesta se escribe aparte, sin ella.
    options.hint ? { clearPromptOnDone: true } : {},
  );

  if (options.hint) {
    writeAnsweredLine(message, answer.trim());
  }

  return answer.trim();
}

/** Si o no; Esc cuenta como no. Escribir no filtra: con dos opciones no hace falta, y Enter elige la marcada. */
export async function confirm(message: string, yesLabel: string, noLabel = 'Cancelar'): Promise<boolean> {
  return chooseOne(
    message,
    [
      { name: yesLabel, value: true },
      { name: noLabel, value: false },
    ],
    undefined,
    { escapeValue: false, filter: false },
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

/**
 * Para redibujar la misma lista igual que la dejo quien la usaba (por ejemplo, cuando termina una carga): lo escrito
 * con que arranca y donde avisar lo escrito y la marcada despues de cada tecla.
 */
export interface ListStepOptions<T> {
  readonly initialTerm?: string;
  readonly onChange?: (state: ListSelectState<Back | T>) => void;
}

export type { ListSelectState } from './list-select';

async function selectStep<T>(
  message: string,
  choices: ReadonlyArray<Choice<T> | Separator>,
  defaultValue: Back | T | undefined,
  pageSize: number,
  options: ListStepOptions<T> & { readonly signal?: AbortSignal } = {},
) {
  const { signal, ...state } = options;

  return runStepPrompt(
    (context) =>
      listSelect<T, Back>(
        {
          ...state,
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
  /** La marcada al empezar; `BACK`, "← Volver". */
  defaultValue?: Back | T,
  pageSize = 12,
  options: ListStepOptions<T> = {},
): Promise<Back | T> {
  const result = await selectStep(message, choices, defaultValue, pageSize, options);

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
  defaultValue: Back | T | undefined,
  pageSize: number,
  loading: Promise<L>,
  options: ListStepOptions<T> = {},
): Promise<LoadingResult<T, L>> {
  const loaded = new AbortController();
  const stop = () => loaded.abort();

  loading.then(stop, stop);

  const result = await selectStep(message, choices, defaultValue, pageSize, { ...options, signal: loaded.signal });

  return 'answer' in result ? result : { loaded: await loading };
}

export interface TextStepOptions {
  readonly defaultValue?: string;
  /** Aclaracion que se ve solo mientras se responde, como `SKIP_HINT`; la respuesta queda con `message` solo. */
  readonly hint?: string;
  /**
   * Lo que se habia escrito, al volver a la pregunta: arranca escrito y se puede editar o borrar (con un
   * `defaultValue`, borrarlo no lo deja vacio). Vacio, la pregunta arranca como la primera vez.
   */
  readonly previousAnswer?: string;
  readonly validate?: (value: string) => string | true;
  /** Lo que se puede escribir, corto y apagado al lado de la ayuda de Esc. No queda en la linea de respuesta. */
  readonly inputHelp?: string;
  /** Lo que muestra la linea "✔ pregunta respuesta" para una respuesta valida: por ejemplo, la fecha resuelta. */
  readonly answered?: (answer: string) => string;
}

/** Como askText, pero Esc (o escribir "<") vuelve al paso anterior. */
export async function askTextStep(message: string, options: TextStepOptions = {}): Promise<Back | string> {
  const previousAnswer = options.previousAnswer?.trim() || undefined;
  const result = await runStepPrompt(
    (context) =>
      input(
        {
          default: previousAnswer ?? options.defaultValue,
          message: `${withHint(message, options.hint)} ${colorize(`(${options.inputHelp ? `${options.inputHelp} ${uiSymbol('bullet')} ` : ''}[esc] para volver)`, 'muted')}`,
          prefill: previousAnswer === undefined ? 'tab' : 'editable',
          theme: TEXT_THEME,
          validate: (value) => (value.trim() === BACK_TEXT ? true : (options.validate?.(value) ?? true)),
        },
        context,
      ),
    (answer) => ({
      answer: options.answered && answer.trim() !== BACK_TEXT ? options.answered(answer.trim()) : answer.trim(),
      message,
    }),
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
              .map((choice) => choice.short ?? choice.name)
              .join(', '),
      message,
    }),
  );

  return 'answer' in result ? result.answer : BACK;
}

export interface EditRowsOptions {
  /** La fila para agregar una mas, por ejemplo "+ Agregar ítem". */
  readonly addLabel: string;
  /** Las filas que quedan como minimo, y por que, si se intenta borrar de mas. */
  readonly minRows: number;
  readonly minRowsNotice: string;
}

/** "1 para modificar, 1 para borrar y uno nuevo", o "sin cambios": lo que queda en la linea de la respuesta. */
function describeRowEdits(edits: RowEdits): string {
  const parts = [
    edits.edit.length > 0 ? `${edits.edit.length} para modificar` : undefined,
    edits.remove.length > 0 ? `${edits.remove.length} para borrar` : undefined,
    edits.add ? 'uno nuevo' : undefined,
  ].filter((part): part is string => part !== undefined);

  if (parts.length === 0) {
    return 'sin cambios';
  }

  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}`;
}

/**
 * Lo que la lista con acciones suma a una lista comun, en el peor caso (9): la linea en blanco y el boton de agregar,
 * la linea en blanco despues de "Volver" y la de antes de la ayuda, el detalle de la fila partido en dos lineas en una
 * terminal angosta, lo marcado, el aviso y el titulo partido en dos lineas. Asi "Volver" no queda fuera de pantalla.
 */
export const ROW_ACTIONS_EXTRA_LINES = 9;

/**
 * Lista con acciones por fila (`rowActionsList`): espacio marca para modificar, Backspace para borrar y Enter aplica,
 * con la fila de agregar. Esc o "← Volver" vuelven al paso anterior.
 */
export async function editRowsStep(
  message: string,
  rows: ReadonlyArray<Omit<RowActionsListRow, 'mark'>>,
  options: EditRowsOptions,
): Promise<Back | RowEdits> {
  const result = await runStepPrompt(
    (context) =>
      rowActionsList(
        {
          ...options,
          backLabel: BACK_CHOICE.name,
          message,
          pageSize: fitPageSize(rows.length, { extraLines: ROW_ACTIONS_EXTRA_LINES }),
          rows,
          theme: STEP_THEME,
        },
        context,
      ),
    (answer) => ({ answer: answer === BACK ? BACK_CHOICE.name : describeRowEdits(answer), message }),
  );

  return 'answer' in result ? result.answer : BACK;
}

export type { FilterListRow } from './filter-list';

interface FilterListOptions<T> {
  readonly defaultValue?: T;
  readonly header?: string;
  readonly help?: string;
  /** Por defecto, las filas que entran en la terminal (`fitPageSize`). */
  readonly pageSize?: number;
}

/** La linea "✔ pregunta respuesta" de una lista que se filtra: lo que deja la fila elegida, o "Volver". */
function filterListAnsweredLine<T>(
  message: string,
  rows: ReadonlyArray<FilterListRow<T>>,
  answer: T | undefined,
): { readonly answer: string; readonly message: string } {
  if (answer === undefined) {
    return { answer: BACK_CHOICE.name, message };
  }

  const row = rows.find((item) => item.value === answer);

  return { answer: row?.short ?? row?.label.replace(/\s+/g, ' ').trim() ?? '', message };
}

/** La fila elegida en una lista que se filtra; Esc o "Volver" (que la cierra sin fila), BACK. */
function filterListChoice<T>(result: { readonly aborted: true } | { readonly answer: Back | T | undefined }): Back | T {
  return 'answer' in result && result.answer !== undefined ? result.answer : BACK;
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
          pageSize: options.pageSize ?? fitPageSize(rows.length, { extraLines: FILTER_LIST_EXTRA_LINES }),
          rows,
          theme: STEP_THEME,
        },
        context,
      ),
    (answer) => filterListAnsweredLine(message, rows, answer),
  );

  return filterListChoice(result);
}

/** Una tabla larga para mirar: se filtra escribiendo y se desplaza con las flechas. Enter o Esc la cierran. */
export async function browseFilterList(
  message: string,
  rows: readonly string[],
  options: Omit<FilterListOptions<string>, 'defaultValue' | 'pageSize'> & { readonly pageSize: number },
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

/**
 * Un contenido en bloques para mirar, que se recorren con ← y → (`render` dibuja cada uno). Enter o Esc lo cierran y
 * no deja rastro en pantalla.
 */
export async function browseBlocks<B extends string>(
  message: string,
  blocks: readonly B[],
  render: (block: B) => string,
  keys: ReadonlyArray<readonly [key: string, action: string]>,
): Promise<void> {
  await runStepPrompt(
    (context) =>
      blockPager<B>(
        {
          blocks,
          help: keys
            .map(([key, action]) => `${bold(key)} ${colorize(action, 'muted')}`)
            .join(colorize(` ${uiSymbol('separator')} `, 'muted')),
          message,
          render,
          theme: STEP_THEME,
        },
        context,
      ),
    () => undefined,
  );
}

export interface ChooseOrTypeStepOptions<T> {
  /**
   * La primera fila de una pregunta opcional (`optional`): dice que pasa si se deja vacia, por ejemplo "Sin CUIT del
   * país (solo ID impositivo)". Arranca marcada si no hay `previous`, y elegirla devuelve `undefined`. Por defecto,
   * "Omitir".
   */
  readonly emptyLabel?: string;
  /** Fila de encabezado fija arriba de la lista (CÓDIGO, PAÍS…), como `chooseFromFilterList`. */
  readonly header?: string;
  readonly help?: string;
  /** Se puede dejar sin valor: suma la fila de `emptyLabel`. Si no, Enter con el filtro vacio elige la primera fila. */
  readonly optional?: boolean;
  /** Por defecto, las filas que entran en la terminal (`fitPageSize`). */
  readonly pageSize?: number;
  /** Convierte lo escrito (ya validado) en el valor del paso, cuando no se elige una fila. */
  readonly parse: (text: string) => T;
  /** Lo respondido antes: si es una fila, arranca marcada; si no, arranca escrito (`String(previous)`). */
  readonly previous?: T;
  /** Valida lo escrito, como `askTextStep`. Una fila elegida no pasa por aca. */
  readonly validate?: (text: string) => string | true;
}

/** Lo que devuelve la lista de `chooseOrTypeStep`: una fila, lo escrito o la fila de "sin valor". */
type ChooseOrTypeAnswer<T> = { readonly row: T } | { readonly text: string } | { readonly empty: true };

/** "Usar lo escrito: Mercado Pago", la fila que usa lo escrito en lugar de una de la lista. */
function typedRowLabel(term: string): string {
  return `Usar lo escrito: ${term}`;
}

/**
 * Sin filas (por ejemplo, ARCA no devolvio la tabla), una pregunta de texto validada, como `askTextStep`. Si es
 * opcional, vacio devuelve `undefined`.
 */
async function typeWithoutRows<T>(message: string, options: ChooseOrTypeStepOptions<T>): Promise<Back | T | undefined> {
  const answer = await askTextStep(message, {
    hint: options.optional ? SKIP_HINT : undefined,
    previousAnswer: options.previous === undefined ? undefined : String(options.previous),
    validate: (text) => (options.optional && !text.trim() ? true : (options.validate?.(text) ?? true)),
  });

  if (answer === BACK) {
    return BACK;
  }

  return options.optional && !answer.trim() ? undefined : options.parse(answer.trim());
}

/**
 * Elegir de una lista que se filtra escribiendo o usar lo escrito (TUI-35): con algo escrito que no es exactamente una
 * fila, debajo de las que coinciden aparece "Usar lo escrito: …", que valida con `validate` y convierte con `parse`.
 * Enter elige la marcada: la primera que coincide con lo escrito o, con el filtro vacio, la de `previous` o la primera
 * (en una opcional, la de `emptyLabel`, que devuelve `undefined`). Con un `previous` que no es una fila, arranca escrito.
 * Sin filas, es una pregunta de texto. Esc y "Volver" vuelven al paso anterior.
 */
export function chooseOrTypeStep<T>(
  message: string,
  rows: ReadonlyArray<FilterListRow<T>>,
  options: ChooseOrTypeStepOptions<T> & { readonly optional?: false },
): Promise<Back | T>;
export function chooseOrTypeStep<T>(
  message: string,
  rows: ReadonlyArray<FilterListRow<T>>,
  options: ChooseOrTypeStepOptions<T>,
): Promise<Back | T | undefined>;
export async function chooseOrTypeStep<T>(
  message: string,
  rows: ReadonlyArray<FilterListRow<T>>,
  options: ChooseOrTypeStepOptions<T>,
): Promise<Back | T | undefined> {
  if (rows.length === 0) {
    return typeWithoutRows(message, options);
  }

  const emptyLabel = options.emptyLabel ?? SKIP_ROW;
  const listed: Array<FilterListRow<ChooseOrTypeAnswer<T>>> = [
    // Solo con el filtro vacio: lo escrito busca un valor, no "sin valor".
    ...(options.optional ? [{ label: emptyLabel, unfilteredOnly: true, value: { empty: true } as const }] : []),
    ...rows.map((row) => ({ ...row, value: { row: row.value } })),
  ];
  const previousRow = listed.find((row) => 'row' in row.value && row.value.row === options.previous);
  const initialTerm = options.previous !== undefined && !previousRow ? String(options.previous) : undefined;
  const result = await runStepPrompt(
    (context) =>
      filterList<ChooseOrTypeAnswer<T>>(
        {
          back: BACK_CHOICE.name,
          default: previousRow?.value,
          header: options.header,
          help: options.help,
          initialTerm,
          message,
          mode: 'elegir',
          // Mas la fila de lo escrito y la linea del error.
          pageSize: options.pageSize ?? fitPageSize(listed.length + 1, { extraLines: FILTER_LIST_EXTRA_LINES + 1 }),
          rows: listed,
          theme: STEP_THEME,
          typed: {
            label: typedRowLabel,
            validate: options.validate,
            value: (term) => ({ text: term.trim() }),
          },
        },
        context,
      ),
    (answer) =>
      answer !== undefined && 'text' in answer
        ? { answer: answer.text, message }
        : filterListAnsweredLine(message, listed, answer),
  );
  const answer = filterListChoice(result);

  if (answer === BACK) {
    return BACK;
  }

  if ('empty' in answer) {
    return undefined;
  }

  return 'row' in answer ? answer.row : options.parse(answer.text);
}
