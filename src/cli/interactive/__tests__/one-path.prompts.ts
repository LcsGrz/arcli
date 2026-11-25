import { BACK } from '../../../modules/interactive/wizard';

import { createScript, type ScriptedAnswer } from './script';

/**
 * Las preguntas de los tests de "un solo camino" (REV-53): el mismo guion responde al comando y al asistente. Va aparte
 * del fixture porque lo importa el `vi.mock` de `../prompts`, que el programa tambien importa.
 */

export type Steps = ReadonlyArray<readonly [RegExp, ScriptedAnswer]>;

let script = createScript([]);
let watch: (message: string) => void = () => undefined;

/** El guion que sigue; `onAsk` corre antes de cada respuesta y, si lanza, la pregunta se corta (Ctrl+C). */
export function startScript(steps: Steps, onAsk: (message: string) => void): typeof script {
  script = createScript(steps);
  watch = onAsk;

  return script;
}

export function ctrlC(): Error {
  return Object.assign(new Error('Ctrl+C'), { name: 'ExitPromptError' });
}

/** El modulo `../prompts` para `vi.mock`: solo se reemplaza lo que pregunta. */
export function scriptedPrompts(actual: typeof import('../prompts')): typeof import('../prompts') {
  // `async`: un Ctrl+C del guion rechaza la pregunta, como el prompt real.
  const asking =
    <Args extends [string, ...unknown[]], R>(ask: (...args: Args) => R) =>
    async (...args: Args) => {
      watch(args[0]);

      return ask(...args);
    };
  const askText = asking((...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args));

  return {
    ...actual,
    askText,
    askTextStep: askText,
    chooseFromFilterList: asking((...args: Parameters<typeof script.chooseFromFilterList>) =>
      script.chooseFromFilterList(...args),
    ),
    chooseManyStep: asking((...args: Parameters<typeof script.chooseManyStep>) => script.chooseManyStep(...args)),
    // Esc devuelve lo que dice cada pregunta: "volver" en el asistente y "no" en los comandos.
    chooseOne: asking(async (...args: Parameters<typeof actual.chooseOne>) => {
      const [message, choices, , options] = args;
      const answer = await script.chooseStep(message, choices);

      return answer === BACK ? options?.escapeValue : answer;
    }),
    chooseOrTypeStep: asking((...args: Parameters<typeof script.chooseOrTypeStep>) => script.chooseOrTypeStep(...args)),
    chooseStep: asking((...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args)),
    chooseStepWhileLoading: (...args: Parameters<typeof script.chooseStepWhileLoading>) =>
      script.chooseStepWhileLoading(...args),
    confirm: asking(async (message: string, yesLabel: string, noLabel?: string) => {
      const answer = await script.chooseStep(message, [
        { name: yesLabel, value: true },
        { name: noLabel ?? 'No', value: false },
      ]);

      return answer === true;
    }),
    editRowsStep: asking((...args: Parameters<typeof script.editRowsStep>) => script.editRowsStep(...args)),
    eraseLastAnswer: () => undefined,
    fitPageSize: () => 12,
  } as unknown as typeof actual;
}
