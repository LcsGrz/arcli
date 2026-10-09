import { Separator } from '@inquirer/select';
import { vi } from 'vitest';

import { BACK } from '../../../modules/interactive/wizard';
import type { Choice } from '../prompts';

/** Las opciones de una lista, sin los separadores. */
export function onlyChoices<T>(choices: ReadonlyArray<Choice<T> | Separator>): Array<Choice<T>> {
  return choices.filter((item): item is Choice<T> => !Separator.isSeparator(item));
}

/** Respuesta guionada: el texto de la opcion a elegir, lo que se tipea, las opciones a marcar, o "volver". */
export type ScriptedAnswer = readonly string[] | string | typeof BACK;

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
  function nextSingle(message: string): string | typeof BACK {
    const answer = next(message);

    if (typeof answer !== 'string' && answer !== BACK) {
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

  const chooseStep = vi.fn(async <T>(message: string, allChoices: ReadonlyArray<Choice<T> | Separator>) => {
    const answer = nextSingle(message);

    if (answer === BACK) {
      return BACK;
    }

    const choices = onlyChoices(allChoices);
    const choice = choices.find((item) => item.name.includes(answer));

    if (!choice) {
      throw new Error(
        `"${answer}" no esta entre las opciones de "${message}": ${choices.map((item) => item.name).join(' | ')}`,
      );
    }

    return choice.value;
  });

  // Devuelve lo marcado en el orden de las opciones, como el checkbox real.
  const chooseManyStep = vi.fn(
    async <T>(message: string, choices: ReadonlyArray<Choice<T>>, _selected?: readonly T[]) => {
      const answer = next(message);

      if (answer === BACK) {
        return BACK;
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
      const answer = nextSingle(message);

      if (answer === BACK) {
        return BACK;
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
