import input from '@inquirer/input';
import select from '@inquirer/select';

export interface Choice<T> {
  readonly description?: string;
  readonly name: string;
  readonly value: T;
}

export async function chooseOne<T>(message: string, choices: ReadonlyArray<Choice<T>>, defaultValue?: T): Promise<T> {
  return select<T>({ choices: [...choices], default: defaultValue, loop: false, message, pageSize: 12 });
}

export async function askText(
  message: string,
  options: { readonly defaultValue?: string; readonly validate?: (value: string) => string | true } = {},
): Promise<string> {
  const answer = await input({
    default: options.defaultValue,
    message,
    validate: options.validate,
  });

  return answer.trim();
}

export async function confirm(message: string, yesLabel: string, noLabel = 'Cancelar'): Promise<boolean> {
  return chooseOne(message, [
    { name: yesLabel, value: true },
    { name: noLabel, value: false },
  ]);
}

/** Ctrl+C dentro de un prompt de @inquirer. */
export function isPromptCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === 'ExitPromptError';
}
