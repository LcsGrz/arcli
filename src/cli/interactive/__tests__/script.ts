import { Separator } from '@inquirer/select';
import { vi } from 'vitest';

import { BACK } from '../../../modules/interactive/wizard';
import type { Choice } from '../prompts';

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
 * Respuesta guionada: el texto de la opcion a elegir, lo que se tipea (con intentos rechazados antes, si los hay), las
 * opciones a marcar, o "volver".
 */
export type ScriptedAnswer = readonly string[] | string | TypedAfterRejections | typeof BACK;

function isTypedAfterRejections(answer: ScriptedAnswer): answer is TypedAfterRejections {
  return typeof answer === 'object' && answer !== null && 'rejected' in answer;
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
      throw new Error(`"${message}" espera una sola respuesta y el guion tiene una lista`);
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
    async <T>(message: string, allChoices: ReadonlyArray<Choice<T> | Separator>, _defaultValue?: T) => {
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

      if (isTypedAfterRejections(answer)) {
        throw new Error(`"${message}" es una seleccion multiple: no se tipea`);
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
    async (message: string, options: { readonly validate?: (value: string) => string | true } = {}) => {
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
    chooseManyStep,
    chooseStep,
    chooseStepWhileLoading,
    remaining: () => queue.length,
  };
}
