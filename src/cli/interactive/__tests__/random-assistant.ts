import { Separator } from '@inquirer/select';
import fc from 'fast-check';

import type { RowEdits } from '../../../modules/interactive/row-marks';
import { BACK } from '../../../modules/interactive/wizard';
import { type RowActionsListRow, stripAnsi } from '../../../ui';
import type { Choice, EditRowsOptions, FilterListRow, TextStepOptions } from '../prompts';

/**
 * Asistente al azar para los tests de propiedades del navegador (NAV-0): reemplaza a `../prompts` y responde como una
 * persona que no sabe lo que quiere. Con probabilidad `backRate` aprieta Esc; en una lista elige cualquier opcion
 * habilitada; en la seleccion multiple marca un subconjunto; en un texto escribe un valor de la tabla `answers` segun
 * la pregunta y, si el validador lo rechaza, prueba otro (como el prompt real, que no sale del paso hasta que valida).
 * Todo sale de `g` (`fc.gen()`), asi fast-check reduce el contraejemplo y lo repite con la semilla.
 *
 * Una pregunta sin fila en la tabla falla con su texto: el arnes depende del texto de las preguntas, a proposito.
 */

/** Lo que pregunto el flujo y lo que respondio el asistente, en orden. */
export type PromptEvent =
  | {
      readonly answer: unknown;
      readonly choices: ReadonlyArray<Choice<unknown>>;
      readonly kind: 'list';
      readonly message: string;
    }
  | {
      readonly answer: unknown;
      readonly choices: ReadonlyArray<Choice<unknown>>;
      readonly kind: 'many';
      readonly message: string;
      /** Lo que arranco marcado. */
      readonly selected: readonly unknown[];
    }
  | {
      readonly answer: string | typeof BACK;
      readonly kind: 'text';
      readonly message: string;
      readonly previousAnswer?: string;
    }
  | {
      readonly answer: RowEdits | typeof BACK;
      readonly kind: 'rows';
      readonly message: string;
      readonly rows: ReadonlyArray<Omit<RowActionsListRow, 'mark'>>;
    };

/** Una fila de la tabla de textos: la pregunta y los valores que se pueden escribir. */
export type TextAnswers = ReadonlyArray<readonly [RegExp, fc.Arbitrary<string>]>;

/** Se paso del tope de preguntas: la corrida no cuenta (no es un error del flujo). */
export class PromptLimitReached extends Error {}

interface RandomAssistantOptions {
  readonly answers: TextAnswers;
  /** Probabilidad de Esc en cada pregunta, en porcentaje. */
  readonly backPercent: number;
  /** Opciones de lista que no elige nunca (por nombre). */
  readonly excludeChoices?: RegExp;
  readonly maxPrompts: number;
}

/** Las respuestas fijas: nunca emite ni guarda nada en la config. */
const FIXED_LIST_ANSWERS: ReadonlyArray<readonly [RegExp, unknown]> = [
  [/^¿Emitimos/, false],
  [/^¿Guardamos/, false],
];

/** Opciones de las listas de comprobantes que abren otra pantalla fuera del flujo (cargar mas, a mano). */
const PICKER_VALUES: ReadonlySet<unknown> = new Set(['a-mano', 'cargar-mas']);

/** Un indice de 0 a `size - 1`, todos igual de probables. */
const unbiasedIndex = (size: number) => fc.noBias(fc.integer({ max: size - 1, min: 0 }));

const plain = (text: string) => stripAnsi(text).replace(' (nuevo)', '');

export function createRandomAssistant(g: fc.GeneratorValue, options: RandomAssistantOptions) {
  const events: PromptEvent[] = [];
  let prompts = 0;

  function count(message: string): void {
    prompts += 1;

    if (prompts > options.maxPrompts) {
      throw new PromptLimitReached(`Mas de ${options.maxPrompts} preguntas (la ultima, "${message}")`);
    }
  }

  // Sin el sesgo de fast-check hacia los valores chicos: si no, Esc y la primera opcion salen casi siempre.
  const percent = () => g(unbiasedIndex, 100);
  // Quien vuelve para cambiar algo suele volver varias preguntas seguidas: despues de un Esc, hasta tres mas.
  let pendingBacks = 0;
  // Esc en la primera pregunta sale del flujo sin preguntar nada: no prueba nada.
  const goesBack = (): boolean => {
    if (prompts <= 1) {
      return false;
    }

    if (pendingBacks > 0) {
      pendingBacks -= 1;

      return true;
    }

    if (percent() >= options.backPercent) {
      return false;
    }

    pendingBacks = g(unbiasedIndex, 4);

    return true;
  };

  async function chooseStep<T>(
    message: string,
    allChoices: ReadonlyArray<Choice<T> | Separator>,
  ): Promise<T | typeof BACK> {
    count(message);

    const choices = allChoices.filter((item): item is Choice<T> => !Separator.isSeparator(item));
    const fixed = FIXED_LIST_ANSWERS.find(([question]) => question.test(message));

    if (fixed) {
      events.push({ answer: fixed[1], choices, kind: 'list', message });

      return fixed[1] as T;
    }

    const selectable = choices.filter(
      (choice) =>
        !choice.disabled &&
        !PICKER_VALUES.has(choice.value) &&
        !(options.excludeChoices && options.excludeChoices.test(plain(choice.name))),
    );
    const answer =
      selectable.length === 0 || goesBack()
        ? BACK
        : (selectable[g(unbiasedIndex, selectable.length)] as Choice<T>).value;

    events.push({ answer, choices, kind: 'list', message });

    return answer;
  }

  async function chooseManyStep<T>(
    message: string,
    choices: ReadonlyArray<Choice<T>>,
    selected: readonly T[] = [],
  ): Promise<T[] | typeof BACK> {
    count(message);

    const answer = goesBack()
      ? BACK
      : choices
          .filter((choice) => !choice.disabled)
          .filter(() => percent() < 40)
          .map((choice) => choice.value);

    events.push({ answer, choices, kind: 'many', message, selected });

    return answer;
  }

  // Una lista con filtro es una lista: cualquier fila, o Esc.
  async function chooseFromFilterList<T>(
    message: string,
    rows: ReadonlyArray<FilterListRow<T>>,
  ): Promise<T | typeof BACK> {
    return chooseStep(
      message,
      rows.map((row) => ({ name: row.label, value: row.value })),
    );
  }

  /**
   * El editor de filas (los items de la E): cada fila se marca para modificar o borrar al azar, sin borrar de mas (el
   * editor real no lo deja), y a veces agrega una. Casi siempre sin marcas, para que el camino llegue a la vista previa.
   */
  async function editRowsStep(
    message: string,
    rows: ReadonlyArray<Omit<RowActionsListRow, 'mark'>>,
    rowOptions: EditRowsOptions,
  ): Promise<RowEdits | typeof BACK> {
    count(message);

    let answer: RowEdits | typeof BACK = BACK;

    if (!goesBack()) {
      const edit: number[] = [];
      const remove: number[] = [];

      rows.forEach((_row, index) => {
        const roll = percent();

        if (roll < 15) {
          edit.push(index);
        } else if (roll < 25 && rows.length - remove.length - 1 >= rowOptions.minRows) {
          remove.push(index);
        }
      });

      answer = { add: percent() < 15, edit, remove };
    }

    events.push({ answer, kind: 'rows', message, rows });

    return answer;
  }

  async function askTextStep(message: string, textOptions: TextStepOptions = {}): Promise<string | typeof BACK> {
    count(message);

    const record = (answer: string | typeof BACK) => {
      events.push({ answer, kind: 'text', message, previousAnswer: textOptions.previousAnswer });

      return answer;
    };

    if (goesBack()) {
      return record(BACK);
    }

    const row = options.answers.find(([question]) => question.test(message));

    if (!row) {
      throw new Error(`Pregunta sin fila en la tabla del asistente al azar: "${message}"`);
    }

    const previous = textOptions.previousAnswer?.trim() ? textOptions.previousAnswer : undefined;
    // Enter con algo escrito lo deja; vacio, el prompt real devuelve el valor por defecto.
    const typed = (value: string) =>
      value === '' && textOptions.defaultValue !== undefined ? textOptions.defaultValue : value;
    const candidates = [
      ...(previous !== undefined && g(fc.boolean) ? [previous] : []),
      ...Array.from({ length: 4 }, () => typed(g(() => row[1]))),
    ];
    const valid = candidates.find((value) => (textOptions.validate?.(value) ?? true) === true);

    // Si nada de lo que sabe escribir pasa, se rinde y vuelve: como una persona que no sabe que poner.
    return record(valid ?? BACK);
  }

  return {
    events,
    prompts: {
      askText: async () => '',
      askTextStep,
      chooseFromFilterList,
      chooseManyStep,
      chooseOne: <T>(message: string, choices: ReadonlyArray<Choice<T> | Separator>) => chooseStep(message, choices),
      chooseStep,
      chooseStepWhileLoading: async <T, L>(
        _message: string,
        _choices: ReadonlyArray<Choice<T> | Separator>,
        _defaultValue: T | undefined,
        _pageSize: number,
        loading: Promise<L>,
      ) => ({ loaded: await loading }),
      confirm: async (message: string) => {
        count(message);

        return false;
      },
      editRowsStep,
      eraseLastAnswer: () => undefined,
      fitPageSize: () => 12,
      isPromptCancellation: () => false,
    },
  };
}

/** La pregunta del monto, con o sin la moneda ("Monto total en USD:"). */
const AMOUNT_QUESTION = /^(Monto total|Monto de la nota)/;

/**
 * Las preguntas a las que vuelve `finalize` desde mas adelante: el monto, si los opcionales cambian la moneda, y la
 * fecha de pago de la E, si la fecha del comprobante que queda la deja antes (TUI-22).
 */
const FINALIZE_TARGET = /^(Monto total|Monto de la nota|Fecha de pago)/;
const amountKey = (message: string): string => message.replace(/ en [A-Z]{3}:$/, ':');

/** Las preguntas del paso de los items de la E (NAV-10): un solo paso del asistente con su propia navegacion. */
const ITEMS_STEP =
  /^(Descripción del ítem \d+|Cantidad:|Unidad:|Importe( en [A-Z]{3})?:|Precio unitario|Importe total de |Ítems de )/;

/**
 * Cada pasada seguida por el paso de los items queda como una sola pregunta: Volver adentro del paso es navegacion
 * propia (de un item al anterior, del total al editor). Si la pasada termina con Esc, se salio del paso hacia atras.
 */
function collapseItemsStep(events: readonly PromptEvent[]): PromptEvent[] {
  const collapsed: PromptEvent[] = [];
  let run: PromptEvent[] = [];
  const flush = () => {
    const last = run.at(-1);

    if (last) {
      collapsed.push({ answer: last.answer === BACK ? BACK : 'ítems', kind: 'text', message: 'ítems' });
    }

    run = [];
  };

  for (const event of events) {
    if (ITEMS_STEP.test(event.message)) {
      run.push(event);
      continue;
    }

    flush();
    collapsed.push(event);
  }

  flush();

  return collapsed;
}

/**
 * Las preguntas del camino que termino valiendo: Esc en una pregunta deshace la anterior (que se vuelve a preguntar),
 * y una pregunta que se repite seguida sin Esc (un reintento, como "Número" si ARCA no lo tiene) reemplaza a la
 * anterior. Un grupo de preguntas que es un solo paso del asistente (los opcionales) se rehace entero: si su primera
 * pregunta (`group`) vuelve a aparecer, lo respondido desde la vez anterior no cuenta. Lo que queda es lo que la
 * persona respondio en el camino final. El monto es una pregunta a la que el asistente vuelve desde mas adelante (si los
 * opcionales cambiaron la moneda, `finalize` vuelve a el, REV-74 #12), y su texto cambia con la moneda: si vuelve a
 * aparecer, lo respondido desde la vez anterior no cuenta.
 */
export function finalPath(events: readonly PromptEvent[], group: RegExp): PromptEvent[] {
  const path: PromptEvent[] = [];

  for (const event of collapseItemsStep(events)) {
    // Volvio al monto (o a la fecha de pago) desde mas adelante: lo de despues no cuenta, y Esc ahi vuelve a la pregunta
    // anterior.
    if (FINALIZE_TARGET.test(event.message)) {
      const earlier = path.findLastIndex((item) => amountKey(item.message) === amountKey(event.message));

      if (earlier >= 0) {
        path.length = earlier + 1;
      }
    }

    if (event.answer === BACK) {
      path.pop();
      continue;
    }

    if (
      AMOUNT_QUESTION.test(event.message) &&
      path.length > 0 &&
      amountKey(path.at(-1)?.message ?? '') === amountKey(event.message)
    ) {
      path.pop();
    }

    const groupStart = group.test(event.message) ? path.findLastIndex((item) => item.message === event.message) : -1;

    if (groupStart >= 0) {
      path.length = groupStart;
    } else if (path.at(-1)?.message === event.message) {
      path.pop();
    }

    path.push(event);
  }

  return path;
}

/** Las preguntas y respuestas en texto, para el mensaje de un contraejemplo. */
export function describeEvents(events: readonly PromptEvent[]): string {
  return events
    .map((event) => {
      if (event.answer === BACK) {
        return `${event.message} → Esc`;
      }

      if (event.kind === 'text') {
        return `${event.message} → ${JSON.stringify(event.answer)}`;
      }

      if (event.kind === 'rows') {
        return `${event.message} → ${JSON.stringify(event.answer)}`;
      }

      const names = (Array.isArray(event.answer) ? event.answer : [event.answer]).map(
        (value) => event.choices.find((choice) => choice.value === value)?.name ?? String(value),
      );

      return `${event.message} → ${names.map(plain).join(', ') || '(nada)'}`;
    })
    .join('\n');
}
