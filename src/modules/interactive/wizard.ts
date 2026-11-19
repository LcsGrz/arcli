import { isDeepStrictEqual } from 'node:util';

/** Respuesta de un paso para volver al anterior. */
export const BACK = Symbol('volver');

export type Back = typeof BACK;

/** Un dato que completa un paso anterior: si falta, el flujo esta mal armado, no es un error de quien lo usa. */
export function requireStepValue<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Falta ${name}: lo completa un paso anterior del asistente.`);
  }

  return value;
}

export interface WizardStep<S> {
  /** Unico entre los pasos del asistente: con el se recuerda la ultima respuesta del paso. */
  readonly name: string;
  /** Pasos que no aplican al estado actual (por ejemplo, el DNI si el receptor es consumidor final). */
  readonly skip?: (state: S) => boolean;
  /**
   * Devuelve los campos que completa o BACK para volver al paso anterior. `previous` es lo que devolvio la ultima vez
   * que se respondio, si sigue valiendo: al volver a la pregunta, arranca marcado o escrito.
   */
  readonly run: (state: S, previous?: Partial<S>) => Promise<Back | Partial<S>>;
}

/** La ultima respuesta de cada paso, por nombre. Un asistente que se vuelve a correr la puede compartir. */
export type WizardAnswers<S> = Map<string, Partial<S>>;

/**
 * Corre los pasos en orden y permite volver atras, una pregunta por paso. Al volver se restaura el estado que habia
 * antes del paso anterior, asi una respuesta vieja no queda colgada si cambia el camino, y el paso recibe su ultima
 * respuesta para ofrecerla de nuevo. Si una respuesta cambia, se olvidan las de los pasos siguientes: podian depender
 * de ella. Devuelve el estado final, o `undefined` si se vuelve desde el primer paso (salir del flujo).
 */
export async function runWizard<S>(
  steps: ReadonlyArray<WizardStep<S>>,
  initial: S,
  answers: WizardAnswers<S> = new Map(),
): Promise<S | undefined> {
  const history: Array<{ readonly index: number; readonly state: S }> = [];
  let state = initial;
  let index = 0;

  while (index < steps.length) {
    const step = steps[index];

    if (!step || step.skip?.(state)) {
      index += 1;
      continue;
    }

    const previous = answers.get(step.name);
    const result = await step.run(state, previous);

    if (result === BACK) {
      const last = history.pop();

      if (!last) {
        return undefined;
      }

      ({ index, state } = last);
      continue;
    }

    if (previous !== undefined && !isDeepStrictEqual(previous, result)) {
      for (const later of steps.slice(index + 1)) {
        answers.delete(later.name);
      }
    }

    answers.set(step.name, result);
    history.push({ index, state });
    state = { ...state, ...result };
    index += 1;
  }

  return state;
}
