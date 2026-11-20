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

/**
 * Lo que un paso recuerda ademas de su respuesta: por ejemplo, lo marcado y las respuestas internas de un grupo de
 * opcionales. Se olvida junto con la respuesta cuando un `dependsOn` la invalida, y no cuenta para `dependsOn`: los que
 * dependen del paso solo ven su respuesta.
 */
export interface StepMemo {
  get<T>(): T | undefined;
  set<T>(value: T): void;
}

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
  /**
   * Pasos que no aplican al estado actual (por ejemplo, el DNI si el receptor es consumidor final). Recibe el memo del
   * paso (sin memo, fuera del motor, cuenta como vacio): no tiene que depender de lo que el mismo paso guarda al
   * responder, o "Volver" desde el siguiente lo saltearia.
   */
  readonly skip?: (state: S, memo?: StepMemo) => boolean;
  /**
   * Un paso que no pregunta en el estado actual pero igual escribe: si devuelve campos, se aplican como su respuesta,
   * sin entrar en la historia ("Volver" lo pasa de largo, no queda atrapado en el). Se mira despues de `skip`.
   */
  readonly auto?: (state: S, memo: StepMemo) => Partial<S> | undefined;
  /**
   * Usa el memo de otro paso del asistente en vez del propio: por ejemplo, el dato obligatorio de un grupo de
   * opcionales guarda lo respondido en el memo del grupo. Ese memo se olvida solo cuando se olvida el del otro paso.
   */
  readonly memoOf?: string;
  /**
   * Campos que escribe el paso: `finalize` vuelve al ultimo paso respondido que escribe el campo que fallo. Con una
   * funcion, segun lo que respondio (el estado de antes del paso y su memo): un grupo de opcionales escribe solo los
   * campos de lo marcado.
   */
  readonly writes?: readonly string[] | ((state: S, memo: StepMemo) => readonly string[]);
  /** Devuelve los campos que completa o BACK para volver al paso anterior. */
  readonly run: (state: S, options: StepRunOptions<S>) => Promise<Back | Partial<S>>;
}

/** Lo que recibe un paso al preguntar, ademas del estado. */
interface StepRunOptions<S> {
  /**
   * Lo que devolvio la ultima vez que se respondio, si sigue valiendo: al volver a la pregunta, arranca marcado o
   * escrito.
   */
  readonly previous?: Partial<S> | undefined;
  /** Lo que el paso recuerda ademas de su respuesta. */
  readonly memo: StepMemo;
  /**
   * El mensaje de `finalize` si se volvio a este paso porque su respuesta no paso el control final: la pregunta lo
   * muestra antes de preguntar de nuevo.
   */
  readonly error?: string | undefined;
  /**
   * Los campos de ese control, para un paso que pregunta varios (un grupo de opcionales vuelve a la pregunta que escribe
   * el campo).
   */
  readonly failedFields?: readonly string[] | undefined;
}

/**
 * Control final, con todas las respuestas: si falla, el asistente vuelve al ultimo paso que escribe `field` (`writes`),
 * con `message`, en vez de terminar. Con varios campos, al dueño del primero que tenga uno respondido. Si ningun paso
 * respondido los escribe, o si el dueño insiste con la misma respuesta, termina igual (el error queda para la vista
 * previa).
 */
export type WizardFinalize<S> = (
  state: S,
) => { readonly field: string | readonly string[]; readonly message: string } | undefined;

/** Un error de `finalize` de un asistente de afuera, para retomar este en la pregunta que escribe el campo. */
interface WizardResume {
  readonly fields: readonly string[];
  readonly message: string;
}

export interface WizardOptions<S> {
  /** Lo que recuerda cada paso ademas de su respuesta, por nombre. Como `answers`, se puede compartir entre corridas. */
  readonly memos?: Map<string, unknown>;
  readonly finalize?: WizardFinalize<S>;
  /**
   * Arranca en el ultimo paso respondido que escribe uno de `fields` (en orden), con el error: los anteriores se dan por
   * respondidos con lo que tenian (con "Volver" se pueden cambiar). Si ninguno lo escribe, arranca desde el primero.
   */
  readonly resume?: WizardResume;
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
 * olvida su respuesta cuenta como cambiada entera para los que dependen de el. La usa tambien quien corre preguntas
 * de a una fuera de `runWizard` (`requiredOptional`).
 */
export function dependentsOf<S>(
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

/**
 * Un `dependsOn` que no nombra un paso anterior no protege de nada, y un `memoOf` que no nombra un paso del asistente
 * no comparte nada: el flujo esta mal armado.
 */
function assertDependencies<S>(steps: ReadonlyArray<WizardStep<S>>): void {
  const names = new Set(steps.map((step) => step.name));

  steps.forEach((step, index) => {
    if (step.memoOf !== undefined && !names.has(step.memoOf)) {
      throw new Error(`El paso ${step.name} usa el memo de ${step.memoOf}, que no es un paso del asistente.`);
    }

    const earlier = new Set(steps.slice(0, index).map((other) => other.name));
    const unknown = step.dependsOn?.map(dependencyStep).filter((name) => !earlier.has(name)) ?? [];

    if (unknown.length > 0) {
      throw new Error(`El paso ${step.name} depende de ${unknown.join(', ')}, que no es un paso anterior.`);
    }
  });
}

function writesOf<S>(step: WizardStep<S> | undefined, state: S, memo: StepMemo): readonly string[] {
  const writes = step?.writes;

  return typeof writes === 'function' ? writes(state, memo) : (writes ?? []);
}

/**
 * Donde retoma `resume`: recorre los pasos con lo que tienen respondido (sin preguntar) y devuelve el ultimo que escribe
 * el primero de `fields` que tenga dueño, o -1. Se corta en el primer paso que aplica y no tiene respuesta.
 */
function findResumeIndex<S>(
  steps: ReadonlyArray<WizardStep<S>>,
  initial: S,
  answers: WizardAnswers<S>,
  memos: Map<string, unknown>,
  fields: readonly string[],
): number {
  const answered: Array<{ readonly index: number; readonly writes: readonly string[] }> = [];
  let state = initial;

  for (const [index, step] of steps.entries()) {
    const memo = stepMemo(memos, step.memoOf ?? step.name);

    if (step.skip?.(state, memo)) {
      continue;
    }

    const automatic = step.auto?.(state, memo);
    const answer = automatic ?? answers.get(step.name);

    if (!answer) {
      break;
    }

    if (!automatic) {
      answered.push({ index, writes: writesOf(step, state, memo) });
    }

    state = { ...state, ...answer };
  }

  for (const field of fields) {
    const owner = answered.findLast((entry) => entry.writes.includes(field));

    if (owner) {
      return owner.index;
    }
  }

  return -1;
}

/** El memo de `name` guardado en `memos`. */
export function stepMemo(memos: Map<string, unknown>, name: string): StepMemo {
  return {
    get: <T>() => memos.get(name) as T | undefined,
    set: <T>(value: T) => {
      memos.set(name, value);
    },
  };
}

/**
 * Corre los pasos en orden y permite volver atras, una pregunta por paso. Al volver se restaura el estado que habia
 * antes del paso anterior, asi una respuesta vieja no queda colgada si cambia el camino, y cada paso recibe su ultima
 * respuesta para ofrecerla de nuevo (todos se vuelven a preguntar; lo recordado solo arranca marcado o escrito). Si una
 * respuesta cambia, se olvidan solo las de los pasos que dependen de ella (`dependsOn`, tambien de forma indirecta),
 * con su memo: el resto sigue ofreciendo la suya, que igual pasa por la validacion del paso. Al final corre `finalize`:
 * si falla, vuelve al paso que escribe el campo (una vez por respuesta: si el paso la repite, termina). Con `resume`
 * arranca en el paso que escribe el campo de un error de afuera. Devuelve el estado final, o `undefined` si se vuelve
 * desde el primer paso (salir del flujo).
 */
export async function runWizard<S>(
  steps: ReadonlyArray<WizardStep<S>>,
  initial: S,
  answers: WizardAnswers<S> = new Map(),
  options: WizardOptions<S> = {},
): Promise<S | undefined> {
  assertDependencies(steps);

  const memos = options.memos ?? new Map<string, unknown>();
  const history: Array<{ readonly index: number; readonly state: S }> = [];
  let state = initial;
  let index = 0;
  let failure:
    | {
        readonly answer: unknown;
        readonly fields: readonly string[];
        readonly index: number;
        readonly key: string;
        readonly message: string;
      }
    | undefined;
  /** El ultimo paso respondido que escribe el primero de `fields` que tenga dueño, o -1. */
  const ownerIndex = (entries: typeof history, fields: readonly string[]): number => {
    for (const field of fields) {
      const found = entries.findLastIndex((entry) => {
        const step = steps[entry.index];

        return writesOf(step, entry.state, stepMemo(memos, step?.memoOf ?? step?.name ?? '')).includes(field);
      });

      if (found >= 0) {
        return found;
      }
    }

    return -1;
  };
  /** Campos cuyo dueño volvio a dar la misma respuesta despues del error: `finalize` ya no vuelve por ellos. */
  const insisted = new Set<string>();
  /** Con `resume`, el paso donde arranca: los anteriores se dan por respondidos con lo que tenian. */
  let resumeAt = options.resume ? findResumeIndex(steps, initial, answers, memos, options.resume.fields) : -1;

  /** Aplica la respuesta de un paso: los que dependen de ella olvidan la suya si cambio. */
  const answer = (step: WizardStep<S>, previous: Partial<S> | undefined, result: Partial<S>): void => {
    // Tambien sin respuesta anterior: un paso que antes se salteaba puede tener dependientes con respuestas viejas.
    if (!isDeepStrictEqual(previous, result)) {
      for (const name of dependentsOf(steps, step.name, previous, result)) {
        answers.delete(name);
        memos.delete(name);
      }
    }

    answers.set(step.name, result);
    state = { ...state, ...result };
  };

  for (;;) {
    if (index >= steps.length) {
      const failed = options.finalize?.(state);
      const fields = failed ? (typeof failed.field === 'string' ? [failed.field] : failed.field) : [];
      const key = fields.join(',');

      if (!failed || insisted.has(key)) {
        return state;
      }

      const owner = ownerIndex(history, fields);

      if (owner < 0) {
        return state;
      }

      ({ index, state } = history[owner] as (typeof history)[number]);
      history.length = owner;
      failure = { answer: answers.get(steps[index]?.name ?? ''), fields, index, key, message: failed.message };
      continue;
    }

    const step = steps[index];

    if (!step) {
      index += 1;
      continue;
    }

    const memo = stepMemo(memos, step.memoOf ?? step.name);

    if (step.skip?.(state, memo)) {
      index += 1;
      continue;
    }

    const automatic = step.auto?.(state, memo);

    if (automatic) {
      answer(step, answers.get(step.name), automatic);
      index += 1;
      continue;
    }

    const previous = answers.get(step.name);

    if (resumeAt > index && previous) {
      history.push({ index, state });
      answer(step, previous, previous);
      index += 1;
      continue;
    }

    if (resumeAt === index && options.resume) {
      const { fields, message } = options.resume;

      failure = { answer: previous, fields, index, key: fields.join(','), message };
    }

    resumeAt = -1;

    const retry = failure?.index === index ? failure : undefined;

    failure = undefined;

    const result = await step.run(state, { error: retry?.message, failedFields: retry?.fields, memo, previous });

    if (result === BACK) {
      const last = history.pop();

      if (!last) {
        return undefined;
      }

      ({ index, state } = last);
      continue;
    }

    if (retry && isDeepStrictEqual(retry.answer, result)) {
      insisted.add(retry.key);
    }

    history.push({ index, state });
    answer(step, previous, result);
    index += 1;
  }
}
