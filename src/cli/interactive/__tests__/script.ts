import { Separator } from '@inquirer/select';
import { vi } from 'vitest';

import type { RowEdits } from '../../../modules/interactive/row-marks';
import { BACK, type Back } from '../../../modules/interactive/wizard';
import type { RowActionsListRow } from '../../../ui';
import { filterRows, sameSearch } from '../filter-list';
import type {
  Choice,
  ChooseOrTypeStepOptions,
  EditRowsOptions,
  FilterListRow,
  ListStepOptions,
  TextStepOptions,
} from '../prompts';
import { SKIP_ROW } from '../text-hints';

export type { ChooseOrTypeStepOptions } from '../prompts';

/** Las opciones de una lista, sin los separadores. */
export function onlyChoices<T>(choices: ReadonlyArray<Choice<T> | Separator>): Array<Choice<T>> {
  return choices.filter((item): item is Choice<T> => !Separator.isSeparator(item));
}

/**
 * Lo que se tipea despues de intentos que el validador rechaza: cada intento tiene que dar un error que coincida con su
 * regex, como el prompt real, que muestra el error y vuelve a preguntar sin salir del paso.
 */
export interface TypedAfterRejections {
  readonly answer: string;
  readonly rejected: ReadonlyArray<readonly [string, RegExp]>;
}

/** `[/DNI/, rejecting('123456', ['12345', /de 6 a 8/])]`: tipea 12345, ve el error y despues tipea 123456. */
export function rejecting(answer: string, ...rejected: ReadonlyArray<readonly [string, RegExp]>): TypedAfterRejections {
  return { answer, rejected };
}

/**
 * Lo que se marca en la lista con acciones por fila (el editor de items de la E), por el comienzo o una parte del
 * nombre de cada fila: para modificar (espacio), para borrar (Backspace) y si se agrega una.
 */
export interface RowEditsAnswer {
  readonly rowEdits: { readonly add?: boolean; readonly edit?: readonly string[]; readonly remove?: readonly string[] };
}

/** `editing({ edit: ['Consultoría'] })`: marca esa fila para modificarla y aprieta Enter. `editing({})`, Enter solo. */
export function editing(marks: RowEditsAnswer['rowEdits']): RowEditsAnswer {
  return { rowEdits: marks };
}

/**
 * Respuesta guionada: el texto de la opcion a elegir, lo que se tipea (con intentos rechazados antes, si los hay), las
 * opciones a marcar, lo que se marca en el editor, o "volver".
 */
export type ScriptedAnswer = readonly string[] | RowEditsAnswer | string | TypedAfterRejections | typeof BACK;

function isTypedAfterRejections(answer: ScriptedAnswer): answer is TypedAfterRejections {
  return typeof answer === 'object' && answer !== null && 'rejected' in answer;
}

function isRowEditsAnswer(answer: ScriptedAnswer): answer is RowEditsAnswer {
  return typeof answer === 'object' && answer !== null && 'rowEdits' in answer;
}

/** Las posiciones de las filas que nombra el guion, cada nombre la primera fila que lo tiene y no se eligio antes. */
function rowPositions(message: string, rows: ReadonlyArray<{ readonly title: string }>, names: readonly string[]) {
  const taken = new Set<number>();

  return names.map((name) => {
    const index = rows.findIndex((row, position) => !taken.has(position) && row.title.includes(name));

    if (index < 0) {
      throw new Error(`"${name}" no esta entre las filas de "${message}": ${rows.map((row) => row.title).join(' | ')}`);
    }

    taken.add(index);

    return index;
  });
}

/** Lo que arranca escrito en el filtro: un `previous` que no es una fila. */
export function chooseOrTypeInitialTerm<T>(
  rows: ReadonlyArray<FilterListRow<T>>,
  options: ChooseOrTypeStepOptions<T>,
): string {
  const { previous } = options;

  return previous !== undefined && !rows.some((row) => row.value === previous) ? String(previous) : '';
}

/** Si lo escrito es exactamente la fila (su texto, lo que deja o sus palabras clave), como `filterList`. */
function isExactChoice<T>(row: FilterListRow<T>, term: string): boolean {
  return [row.label, row.short, row.keywords].some((text) => text !== undefined && sameSearch(text, term));
}

/**
 * Enter en `chooseOrTypeStep` con `term` en el filtro, como el componente: la primera fila que coincide (con la misma
 * busqueda que `filterList`, y en una opcional primero la de `emptyLabel`, que es "sin valor") o, si ninguna, lo
 * escrito validado y convertido ("Usar lo escrito"). Vacio, la marcada: la de `previous` o, si no, la primera (en una
 * opcional, la de "sin valor"). Sin filas es una pregunta de texto: vacio es "sin valor" si es opcional o lo que diga
 * `validate('')`.
 */
export function enterOnChooseOrType<T>(
  rows: ReadonlyArray<FilterListRow<T>>,
  options: ChooseOrTypeStepOptions<T>,
  term: string,
): { readonly error: string } | { readonly value: T | undefined } {
  const listed = rows.length > 0;

  if (!term.trim()) {
    if (options.previous !== undefined && rows.some((row) => row.value === options.previous)) {
      return { value: options.previous };
    }

    if (options.optional) {
      return { value: undefined };
    }

    if (listed && options.requireChoice) {
      return { error: options.requireChoice };
    }

    if (listed) {
      return { value: (rows[0] as FilterListRow<T>).value };
    }
  } else if (listed && options.optional && sameSearch(options.emptyLabel ?? SKIP_ROW, term)) {
    // La fila de "sin valor" no se busca (solo se ve con el filtro vacio): el guion la nombra entera para elegirla con
    // las flechas.
    return { value: undefined };
  }

  const matches = term.trim() ? filterRows(rows, term) : [];
  // Como el componente: la fila que es exactamente lo escrito gana a la primera que coincide.
  const row = matches.find((item) => isExactChoice(item, term)) ?? matches[0];

  if (row) {
    return { value: row.value };
  }

  const valid = options.validate?.(term) ?? true;

  return valid === true ? { value: options.parse(term.trim()) } : { error: valid };
}

interface ScriptStep {
  readonly answer: ScriptedAnswer;
  readonly question: RegExp;
}

/**
 * Guion de un flujo interactivo. Cada pregunta tiene que coincidir con la siguiente del guion,
 * asi el test falla si el flujo pregunta otra cosa o en otro orden.
 */
export function createScript(steps: ReadonlyArray<readonly [RegExp, ScriptedAnswer]>) {
  const queue: ScriptStep[] = steps.map(([question, answer]) => ({ answer, question }));
  const asked: string[] = [];

  /** Para preguntas de una sola respuesta: una lista de opciones solo vale en la seleccion multiple. */
  function nextSingle(message: string): string | TypedAfterRejections | typeof BACK {
    const answer = next(message);

    if (typeof answer !== 'string' && answer !== BACK && !isTypedAfterRejections(answer)) {
      throw new Error(`"${message}" espera una sola respuesta y el guion tiene una lista o marcas del editor`);
    }

    return answer;
  }

  function next(message: string): ScriptedAnswer {
    asked.push(message);
    const step = queue.shift();

    if (!step) {
      throw new Error(`Pregunta sin respuesta en el guion: "${message}"`);
    }

    if (!step.question.test(message)) {
      throw new Error(`Se esperaba ${step.question} y se pregunto "${message}"`);
    }

    return step.answer;
  }

  // El valor por defecto no cambia la respuesta: queda en `mock.calls` para verificar que opcion arranca marcada.
  const chooseStep = vi.fn(
    async <T>(
      message: string,
      allChoices: ReadonlyArray<Choice<T> | Separator>,
      _defaultValue?: typeof BACK | T,
      _pageSize?: number,
      _options?: ListStepOptions<T>,
    ) => {
      const answer = nextSingle(message);

      if (answer === BACK) {
        return BACK;
      }

      if (typeof answer !== 'string') {
        throw new Error(`"${message}" es una lista: no se tipea, y el guion tiene intentos rechazados`);
      }

      const choices = onlyChoices(allChoices);
      const choice = choices.find((item) => item.name.includes(answer));

      if (!choice) {
        throw new Error(
          `"${answer}" no esta entre las opciones de "${message}": ${choices.map((item) => item.name).join(' | ')}`,
        );
      }

      // Como la lista real, que no deja elegir una opcion deshabilitada.
      if (choice.disabled) {
        throw new Error(
          `"${choice.name}" esta deshabilitada en "${message}"${typeof choice.disabled === 'string' ? `: ${choice.disabled}` : ''}`,
        );
      }

      return choice.value;
    },
  );

  // Devuelve lo marcado en el orden de las opciones, como el checkbox real.
  const chooseManyStep = vi.fn(
    async <T>(message: string, choices: ReadonlyArray<Choice<T>>, _selected?: readonly T[]) => {
      const answer = next(message);

      if (answer === BACK) {
        return BACK;
      }

      if (isTypedAfterRejections(answer) || isRowEditsAnswer(answer)) {
        throw new Error(`"${message}" es una seleccion multiple: no se tipea ni se marca como el editor`);
      }

      const names = typeof answer === 'string' ? [answer] : answer;

      for (const name of names) {
        if (!choices.some((item) => item.name.includes(name))) {
          throw new Error(
            `"${name}" no esta entre las opciones de "${message}": ${choices.map((item) => item.name).join(' | ')}`,
          );
        }
      }

      return choices.filter((item) => names.some((name) => item.name.includes(name))).map((item) => item.value);
    },
  );

  const askTextStep = vi.fn(
    // `previousAnswer` y `defaultValue` no cambian la respuesta: quedan en `mock.calls` para verificar con que arranca.
    async (message: string, options: TextStepOptions = {}) => {
      const scripted = nextSingle(message);

      if (scripted === BACK) {
        return BACK;
      }

      const answer = typeof scripted === 'string' ? scripted : scripted.answer;

      for (const [value, error] of typeof scripted === 'string' ? [] : scripted.rejected) {
        const result = options.validate?.(value) ?? true;

        if (result === true || !error.test(result)) {
          throw new Error(
            `"${value.length > 40 ? `${value.slice(0, 40)}…` : value}" tenia que dar un error como ${error} en "${message}" y dio ${result === true ? 'valido' : `"${result}"`}`,
          );
        }
      }

      const valid = options.validate?.(answer) ?? true;

      if (valid !== true) {
        throw new Error(`"${answer}" no pasa la validacion de "${message}": ${valid}`);
      }

      return answer;
    },
  );

  // Como si se escribiera en el filtro y se eligiera la primera fila que lo contiene. Vacio, Enter: la que arranca marcada.
  const chooseFromFilterList = vi.fn(
    async <T>(message: string, rows: ReadonlyArray<FilterListRow<T>>, options?: { readonly defaultValue?: T }) => {
      const answer = nextSingle(message);

      if (answer === BACK) {
        return BACK;
      }

      if (answer === '' && options?.defaultValue !== undefined) {
        return options.defaultValue;
      }

      if (typeof answer !== 'string') {
        throw new Error(`"${message}" es una lista: no se tipea, y el guion tiene intentos rechazados`);
      }

      const row = rows.find((item) => item.label.includes(answer));

      if (!row) {
        throw new Error(
          `"${answer}" no esta entre las filas de "${message}": ${rows.map((item) => item.label).join(' | ')}`,
        );
      }

      return row.value;
    },
  );

  /**
   * Tests primero (TUI-35): como si se escribiera en el filtro y se apretara Enter (`enterOnChooseOrType`). Vacio es
   * Enter sin tocar nada: con un `previous` que no es una fila, lo que arranca escrito. Los intentos rechazados
   * (`rejecting`) se escriben y tienen que dar el error, sin coincidir con una fila.
   */
  const chooseOrTypeStep = vi.fn(
    async <T>(
      message: string,
      rows: ReadonlyArray<FilterListRow<T>>,
      options: ChooseOrTypeStepOptions<T>,
    ): Promise<Back | T | undefined> => {
      const scripted = nextSingle(message);

      if (scripted === BACK) {
        return BACK;
      }

      for (const [value, error] of typeof scripted === 'string' ? [] : scripted.rejected) {
        const result = enterOnChooseOrType(rows, options, value);

        if (!('error' in result) || !error.test(result.error)) {
          throw new Error(
            `"${value}" tenia que dar un error como ${error} en "${message}" y dio ${'error' in result ? `"${result.error}"` : 'valido'}`,
          );
        }
      }

      const answer = typeof scripted === 'string' ? scripted : scripted.answer;
      const term = answer === '' ? chooseOrTypeInitialTerm(rows, options) : answer;
      const result = enterOnChooseOrType(rows, options, term);

      if ('error' in result) {
        throw new Error(`"${term}" no cierra "${message}": ${result.error}`);
      }

      return result.value;
    },
  );

  // Como el editor real: no deja marcar para borrar mas alla del minimo de filas.
  const editRowsStep = vi.fn(
    async (
      message: string,
      rows: ReadonlyArray<Omit<RowActionsListRow, 'mark'>>,
      options: EditRowsOptions,
    ): Promise<RowEdits | typeof BACK> => {
      const answer = next(message);

      if (answer === BACK) {
        return BACK;
      }

      if (!isRowEditsAnswer(answer)) {
        throw new Error(`"${message}" es el editor de filas: el guion tiene que decir que marca (\`editing\`)`);
      }

      const remove = rowPositions(message, rows, answer.rowEdits.remove ?? []).sort((a, b) => a - b);
      const edit = rowPositions(message, rows, answer.rowEdits.edit ?? [])
        .filter((index) => !remove.includes(index))
        .sort((a, b) => a - b);

      if (rows.length - remove.length < options.minRows) {
        throw new Error(`"${message}" no deja borrar tantas filas: ${options.minRowsNotice}`);
      }

      return { add: answer.rowEdits.add ?? false, edit, remove };
    },
  );

  // La lista que queda en pantalla mientras carga no consume el guion: siempre gana la carga.
  const chooseStepWhileLoading = vi.fn(
    async <T, L>(
      _message: string,
      _choices: ReadonlyArray<Choice<T> | Separator>,
      _defaultValue: T | undefined,
      _pageSize: number,
      loading: Promise<L>,
    ) => ({ loaded: await loading }),
  );

  return {
    asked,
    askTextStep,
    chooseFromFilterList,
    chooseManyStep,
    chooseOrTypeStep,
    chooseStep,
    chooseStepWhileLoading,
    editRowsStep,
    remaining: () => queue.length,
  };
}

/**
 * Las respuestas de un solo ítem de la E con la cantidad y la unidad por defecto (NAV-10): la descripción (vacía,
 * "Según detalle"), el precio, Enter en el ítem 2 y "Confirmar" en el total. Es lo que antes era el monto y la
 * descripción.
 */
export function singleExportItem(price: string, description = ''): ReadonlyArray<readonly [RegExp, ScriptedAnswer]> {
  return [
    [/^Descripción del ítem 1:/, description],
    [/^Cantidad:/, ''],
    [/^Unidad:/, 'unidades'],
    [/^(?:Importe|Precio unitario)/, price],
    [/^Descripción del ítem 2 \(Enter para terminar\):/, ''],
    [/^Importe total/, 'Confirmar'],
  ];
}

/** Los ítems copiados (Repetir y notas E) tal cual: Enter sin marcas en el editor y "Confirmar" en el total. */
export const KEEP_EXPORT_ITEMS: ReadonlyArray<readonly [RegExp, ScriptedAnswer]> = [
  [/^Ítems de .*: modificá o eliminá ítems/, editing({})],
  [/^Importe total/, 'Confirmar'],
];

/**
 * La nota E arranca en el editor con los ítems del asociado (NAV-10): modifica el primero con otro precio (y, si se da,
 * otra descripción), con la cantidad y la unidad que tenía, y confirma el total. Es lo que antes era el monto y el detalle.
 */
export function noteExportItem(price: string, description = ''): ReadonlyArray<readonly [RegExp, ScriptedAnswer]> {
  return [
    [/^Ítems de .*: modificá o eliminá ítems/, editing({ edit: [''] })],
    [/^Descripción del ítem 1:/, description],
    [/^Cantidad:/, ''],
    [/^Unidad:/, ''],
    [/^(?:Importe|Precio unitario)/, price],
    [/^Importe total/, 'Confirmar'],
  ];
}
