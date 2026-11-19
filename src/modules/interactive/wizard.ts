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

/**
 * Un paso anterior del que depende otro: por nombre (cualquier cambio en su respuesta cuenta) o solo por algunos campos
 * de su respuesta, con `.` para los anidados (`options.voucherDate`): si cambian otros, no cuenta.
 */
export type WizardDependency = string | { readonly fields: readonly string[]; readonly step: string };

export interface WizardStep<S> {
  /** Unico entre los pasos del asistente: con el se recuerda la ultima respuesta del paso. */
  readonly name: string;
  /**
   * Pasos anteriores de los que lee algo para preguntar: el texto, las opciones, la opcion por defecto o la validacion
   * (por ejemplo, el numero de documento depende del tipo). Si la respuesta de uno de ellos cambia (o, con `fields`, uno
   * de esos campos), este paso olvida la suya, y tambien los que dependen de este. Solo tiene efecto en un paso que usa
   * `previous`, o del que depende otro que lo usa.
   */
  readonly dependsOn?: readonly WizardDependency[];
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

const dependencyStep = (dependency: WizardDependency): string =>
  typeof dependency === 'string' ? dependency : dependency.step;

function fieldAt(answer: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined),
      answer,
    );
}

/** Si el cambio de respuesta de `changed` (de `before` a `after`) afecta a quien declara `dependency`. */
function isAffected(dependency: WizardDependency, changed: string, before: unknown, after: unknown): boolean {
  if (typeof dependency === 'string') {
    return dependency === changed;
  }

  return (
    dependency.step === changed &&
    dependency.fields.some((field) => !isDeepStrictEqual(fieldAt(before, field), fieldAt(after, field)))
  );
}

/**
 * Los pasos que dependen del cambio de respuesta de `name`, directa o indirectamente: olvidan la suya. Un paso que
 * olvida su respuesta cuenta como cambiada entera para los que dependen de el.
 */
function dependentsOf<S>(
  steps: ReadonlyArray<WizardStep<S>>,
  name: string,
  before: unknown,
  after: unknown,
): Set<string> {
  const dependents = new Set<string>();
  const direct = steps.filter((step) =>
    step.dependsOn?.some((dependency) => isAffected(dependency, name, before, after)),
  );
  const pending = direct.map((step) => step.name);

  pending.forEach((dependent) => dependents.add(dependent));

  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    for (const step of steps) {
      if (!dependents.has(step.name) && step.dependsOn?.some((dependency) => dependencyStep(dependency) === current)) {
        dependents.add(step.name);
        pending.push(step.name);
      }
    }
  }

  return dependents;
}

/** Un `dependsOn` que no nombra un paso anterior no protege de nada: el flujo esta mal armado. */
function assertDependencies<S>(steps: ReadonlyArray<WizardStep<S>>): void {
  steps.forEach((step, index) => {
    const earlier = new Set(steps.slice(0, index).map((other) => other.name));
    const unknown = step.dependsOn?.map(dependencyStep).filter((name) => !earlier.has(name)) ?? [];

    if (unknown.length > 0) {
      throw new Error(`El paso ${step.name} depende de ${unknown.join(', ')}, que no es un paso anterior.`);
    }
  });
}

/**
 * Corre los pasos en orden y permite volver atras, una pregunta por paso. Al volver se restaura el estado que habia
 * antes del paso anterior, asi una respuesta vieja no queda colgada si cambia el camino, y cada paso recibe su ultima
 * respuesta para ofrecerla de nuevo (todos se vuelven a preguntar; lo recordado solo arranca marcado o escrito). Si una
 * respuesta cambia, se olvidan solo las de los pasos que dependen de ella (`dependsOn`, tambien de forma indirecta): el
 * resto sigue ofreciendo la suya, que igual pasa por la validacion del paso. Devuelve el estado final, o `undefined` si
 * se vuelve desde el primer paso (salir del flujo).
 */
export async function runWizard<S>(
  steps: ReadonlyArray<WizardStep<S>>,
  initial: S,
  answers: WizardAnswers<S> = new Map(),
): Promise<S | undefined> {
  assertDependencies(steps);

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

    // Tambien sin respuesta anterior: un paso que antes se salteaba puede tener dependientes con respuestas viejas.
    if (!isDeepStrictEqual(previous, result)) {
      for (const name of dependentsOf(steps, step.name, previous, result)) {
        answers.delete(name);
      }
    }

    answers.set(step.name, result);
    history.push({ index, state });
    state = { ...state, ...result };
    index += 1;
  }

  return state;
}
