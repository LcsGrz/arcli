import { vi } from 'vitest';

import { BACK } from '../../../modules/interactive/wizard';
import type { Choice } from '../prompts';

/** Respuesta guionada: el texto de la opcion a elegir, lo que se tipea, o "volver". */
export type ScriptedAnswer = string | typeof BACK;

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

  const chooseStep = vi.fn(async <T>(message: string, choices: ReadonlyArray<Choice<T>>) => {
    const answer = next(message);

    if (answer === BACK) {
      return BACK;
    }

    const choice = choices.find((item) => item.name.includes(answer));

    if (!choice) {
      throw new Error(
        `"${answer}" no esta entre las opciones de "${message}": ${choices.map((item) => item.name).join(' | ')}`,
      );
    }

    return choice.value;
  });

  const askTextStep = vi.fn(
    async (message: string, options: { readonly validate?: (value: string) => string | true } = {}) => {
      const answer = next(message);

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

  return { asked, askTextStep, chooseStep, remaining: () => queue.length };
}
