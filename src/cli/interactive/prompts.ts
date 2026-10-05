import checkbox from '@inquirer/checkbox';
import input from '@inquirer/input';
import select from '@inquirer/select';

import { BACK, type Back } from '../../modules/interactive/wizard';
import { colorize } from '../../ui';

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

const BACK_CHOICE = { name: '← Volver', value: BACK } as const;
const BACK_TEXT = '<';

/** Como chooseOne, con una opcion "← Volver" al final para el motor de pasos. */
export async function chooseStep<T>(
  message: string,
  choices: ReadonlyArray<Choice<T>>,
  defaultValue?: T,
): Promise<Back | T> {
  return select<Back | T>({
    choices: [...choices, BACK_CHOICE],
    default: defaultValue,
    loop: false,
    message,
    pageSize: 12,
  });
}

/** Como askText, pero escribir "<" vuelve al paso anterior. */
export async function askTextStep(
  message: string,
  options: { readonly defaultValue?: string; readonly validate?: (value: string) => string | true } = {},
): Promise<Back | string> {
  const answer = await askText(`${message} ${colorize('(< para volver)', 'muted')}`, {
    defaultValue: options.defaultValue,
    validate: (value) => (value.trim() === BACK_TEXT ? true : (options.validate?.(value) ?? true)),
  });

  return answer === BACK_TEXT ? BACK : answer;
}

/**
 * Seleccion multiple: espacio marca, Enter confirma (sin marcar nada tambien vale). Tiene un "← Volver" al
 * final para el motor de pasos: si se marca, vuelve al paso anterior.
 */
export async function chooseManyStep<T>(
  message: string,
  choices: ReadonlyArray<Choice<T>>,
  selected: readonly T[] = [],
): Promise<Back | T[]> {
  const answer = await checkbox<Back | T>({
    choices: [...choices.map((choice) => ({ ...choice, checked: selected.includes(choice.value) })), BACK_CHOICE],
    loop: false,
    message,
    pageSize: 12,
  });

  return answer.includes(BACK) ? BACK : (answer as T[]);
}
