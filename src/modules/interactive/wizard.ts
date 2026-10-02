/** Respuesta de un paso para volver al anterior. */
export const BACK = Symbol('volver');

export type Back = typeof BACK;

export interface WizardStep<S> {
  readonly name: string;
  /** Pasos que no aplican al estado actual (por ejemplo, el DNI si el receptor es consumidor final). */
  readonly skip?: (state: S) => boolean;
  /** Devuelve los campos que completa o BACK para volver al paso anterior. */
  readonly run: (state: S) => Promise<Back | Partial<S>>;
}

/**
 * Corre los pasos en orden y permite volver atras. Al volver se restaura el estado que habia antes
 * del paso anterior, asi una respuesta vieja no queda colgada si cambia el camino.
 * Devuelve el estado final, o `undefined` si se vuelve desde el primer paso (salir del flujo).
 */
export async function runWizard<S>(steps: ReadonlyArray<WizardStep<S>>, initial: S): Promise<S | undefined> {
  const history: Array<{ readonly index: number; readonly state: S }> = [];
  let state = initial;
  let index = 0;

  while (index < steps.length) {
    const step = steps[index];

    if (!step || step.skip?.(state)) {
      index += 1;
      continue;
    }

    const result = await step.run(state);

    if (result === BACK) {
      const previous = history.pop();

      if (!previous) {
        return undefined;
      }

      ({ index, state } = previous);
      continue;
    }

    history.push({ index, state });
    state = { ...state, ...result };
    index += 1;
  }

  return state;
}
