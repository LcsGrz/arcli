import { isDeepStrictEqual } from 'node:util';

/** Respuesta de un paso para volver al anterior. */
export const BACK = Symbol('volver');

export type Back = typeof BACK;

/**
 * La respuesta de un paso que corrio sin preguntar (consulto algo y resulto que no hacia falta): no escribe nada ni
 * entra en la historia, asi "Volver" y la vista previa rechazada llegan a una pregunta de verdad, sin consultar de nuevo
 * por el camino. Se compara por identidad. Entre las respuestas queda solo como marca de que corrio, para que `resume`
 * lo pase de largo: no es una respuesta anterior ni hace olvidar a los que dependen del paso.
 */
export const NOT_ASKED: Readonly<Record<string, never>> = Object.freeze({});

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
   * Lo que muestra un paso salteado al pasar hacia adelante, en el lugar de la pregunta: por ejemplo, la cotizacion que
   * exige ARCA y que por eso no se pregunta. No escribe nada ni entra en la historia: "Volver" lo pasa de largo.
   */
  readonly skipNotice?: (state: S) => Promise<void>;
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
  /**
   * Un dato que se puede cambiar desde "¿Emitimos?" ("No, editar datos", TUI-29). Los pasos con el mismo `id` son un
   * solo dato y se editan juntos (la moneda y el monto); la etiqueta y `describe` (el valor actual, con el estado final)
   * salen del primero que se respondio.
   */
  readonly edit?: { readonly describe: (state: S) => string; readonly id: string; readonly label: string };
  /** Devuelve los campos que completa, BACK para volver al paso anterior o `NOT_ASKED` si no pregunto nada. */
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
  /**
   * Corre al final, despues de `finalize`, con el estado completo: la vista previa y "¿Emitimos?". Si devuelve BACK
   * (Esc), el asistente vuelve a la ultima pregunta respondida, con todo lo respondido, en vez de terminar (TUI-15).
   * Con `{ edit }`, pregunta solo esos datos (TUI-29) y vuelve a llamarlo con la entrada nueva.
   */
  readonly confirm?: (state: S, context: WizardConfirmContext) => Promise<WizardConfirmResult>;
}

/**
 * Un dato de "¿Qué datos cambiamos?": un `id` de `edit`, con su etiqueta y su valor actual. Se exporta cuando lo use el
 * cierre (TUI-29 PR 1, `emission-closing.ts`); mientras, `WizardConfirmContext["editable"]`.
 */
interface WizardEditable {
  readonly id: string;
  readonly label: string;
  readonly value: string;
}

/** Lo que recibe `confirm` ademas del estado. */
export interface WizardConfirmContext {
  /** En el orden de los pasos, uno por `id`: los pasos respondidos con `edit` (sin los salteados, `auto` ni `NOT_ASKED`). */
  readonly editable: readonly WizardEditable[];
  /**
   * Si se volvio con Esc desde la primera pregunta editada: reabrir la lista con esto marcado. El estado es el mismo
   * objeto que antes de editar, asi el cierre reconoce su vista previa por identidad y no consulta ARCA de nuevo.
   */
  readonly reopen?: { readonly marked: readonly string[] };
}

/** BACK vuelve a la ultima pregunta, nada termina y `{ edit }` pregunta esos `id` de `edit` (TUI-29). */
export type WizardConfirmResult = Back | void | { readonly edit: readonly string[] };

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

    if (answer === NOT_ASKED) {
      continue;
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

/**
 * Los datos editables de lo respondido: la historia solo tiene preguntas de verdad (ni salteados, ni `auto`, ni
 * `NOT_ASKED`) y va en el orden de los pasos, asi que el primero de cada `id` es el primer paso del grupo.
 */
function editableOf<S>(
  steps: ReadonlyArray<WizardStep<S>>,
  history: ReadonlyArray<{ readonly index: number }>,
  state: S,
): WizardEditable[] {
  const editable: WizardEditable[] = [];

  for (const { index } of history) {
    const edit = steps[index]?.edit;

    if (edit && !editable.some((entry) => entry.id === edit.id)) {
      editable.push({ id: edit.id, label: edit.label, value: edit.describe(state) });
    }
  }

  return editable;
}

/**
 * Un paso de edicion en curso (TUI-29): recorre el flujo desde el principio como `resume`, pero para en lo marcado y en
 * lo que aplica sin respuesta. `before` es lo de antes de editar, para descartarlo todo con Esc en la primera pregunta.
 */
interface EditPass<S> {
  readonly marked: readonly string[];
  /** Los pasos preguntados en este paso de edicion: si se vuelve a uno, se vuelve a preguntar aunque tenga respuesta. */
  readonly asked: Set<number>;
  /** Las preguntas respondidas, para que Esc vuelva a la anterior y no a un paso que paso sin preguntar. */
  readonly stack: Array<{ readonly historyLength: number; readonly index: number; readonly state: S }>;
  readonly before: {
    readonly answers: ReadonlyArray<[string, Partial<S>]>;
    readonly history: ReadonlyArray<{ readonly index: number; readonly state: S }>;
    readonly insisted: readonly string[];
    readonly memos: ReadonlyArray<[string, unknown]>;
    readonly state: S;
  };
}

/** Vacia `map` y lo vuelve a llenar con `entries`: `answers` y `memos` pueden ser de afuera y se comparten por identidad. */
function refill<K, V>(map: Map<K, V>, entries: ReadonlyArray<[K, V]>): void {
  map.clear();
  entries.forEach(([key, value]) => map.set(key, value));
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
 * arranca en el paso que escribe el campo de un error de afuera. Despues de `finalize` corre `confirm` (la vista
 * previa): si vuelve, retoma en la ultima pregunta respondida. Si pide editar datos, recorre el flujo de nuevo
 * preguntando solo eso y lo que quedo sin respuesta (`EditPass`), y vuelve a `confirm`. Devuelve el estado final, o
 * `undefined` si se vuelve desde el primer paso (salir del flujo).
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
  /** Con "No, editar datos" en "¿Emitimos?", el paso de edicion en curso (TUI-29). */
  let editing: EditPass<S> | undefined;
  /** Con Esc en la primera pregunta editada: lo marcado, para que `confirm` reabra la lista. */
  let reopen: WizardConfirmContext['reopen'];

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

  /**
   * Esc en la primera pregunta editada: todo queda como antes de editar, mutando los mismos `Map` (pueden ser de afuera)
   * y con el mismo objeto de estado, y se vuelve a `confirm` para reabrir la lista.
   */
  const discardEdit = (pass: EditPass<S>): void => {
    refill(answers, pass.before.answers);
    refill(memos, pass.before.memos);
    history.splice(0, history.length, ...pass.before.history);
    insisted.clear();
    pass.before.insisted.forEach((key) => insisted.add(key));
    state = pass.before.state;
    index = steps.length;
    reopen = { marked: pass.marked };
  };

  for (;;) {
    if (index >= steps.length) {
      // El paso de edicion termina al llegar al final: si `finalize` falla, vuelve al dueño del campo como siempre.
      editing = undefined;

      // Al reabrir la lista, lo de antes de editar ya paso `finalize`: no se controla de nuevo.
      if (!reopen) {
        const failed = options.finalize?.(state);
        const fields = failed ? (typeof failed.field === 'string' ? [failed.field] : failed.field) : [];
        const key = fields.join(',');

        const owner = failed && !insisted.has(key) ? ownerIndex(history, fields) : -1;

        if (failed && owner >= 0) {
          ({ index, state } = history[owner] as (typeof history)[number]);
          history.length = owner;
          failure = { answer: answers.get(steps[index]?.name ?? ''), fields, index, key, message: failed.message };
          continue;
        }
      }

      const context: WizardConfirmContext = {
        editable: editableOf(steps, history, state),
        ...(reopen ? { reopen } : {}),
      };

      reopen = undefined;

      // La vista previa: con Esc en "¿Emitimos?", de vuelta a la ultima pregunta respondida (TUI-15).
      const confirmed = await options.confirm?.(state, context);

      // "No, editar datos": se recorre el flujo de nuevo desde el principio, preguntando solo lo marcado (TUI-29).
      if (typeof confirmed === 'object') {
        editing = {
          asked: new Set(),
          before: { answers: [...answers], history: [...history], insisted: [...insisted], memos: [...memos], state },
          marked: confirmed.edit,
          stack: [],
        };
        insisted.clear();
        history.length = 0;
        state = initial;
        index = 0;
        continue;
      }

      if (confirmed !== BACK) {
        return state;
      }

      const last = history.pop();

      if (!last) {
        return undefined;
      }

      // De vuelta desde la vista previa: si la misma respuesta vuelve a fallar, `finalize` vuelve a llevar al dueño.
      insisted.clear();
      ({ index, state } = last);
      continue;
    }

    const step = steps[index];

    if (!step) {
      index += 1;
      continue;
    }

    const memo = stepMemo(memos, step.memoOf ?? step.name);

    if (step.skip?.(state, memo)) {
      // Al pasar hacia adelante, no al retomar con `resume` ni al editar (que recorren sin mostrar nada).
      if (!(resumeAt > index) && !editing) {
        await step.skipNotice?.(state);
      }

      index += 1;
      continue;
    }

    const automatic = step.auto?.(state, memo);

    if (automatic) {
      answer(step, answers.get(step.name), automatic);
      index += 1;
      continue;
    }

    const stored = answers.get(step.name);
    // Al editar, pasa sin preguntar lo que no esta marcado ni se pregunto ya en este paso de edicion; lo que no tiene
    // respuesta (la olvido un `dependsOn` o antes se salteaba) se pregunta igual, como en `resume`.
    const passes =
      resumeAt > index ||
      (editing !== undefined &&
        !editing.asked.has(index) &&
        !(step.edit !== undefined && editing.marked.includes(step.edit.id)));

    if (passes && stored === NOT_ASKED) {
      index += 1;
      continue;
    }

    const previous = stored === NOT_ASKED ? undefined : stored;

    if (passes && previous) {
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

    if (result === BACK && editing) {
      // Al editar, Esc vuelve a la pregunta editada anterior; desde la primera, se descarta todo y se reabre la lista.
      const asked = editing.stack.pop();

      if (asked) {
        ({ index, state } = asked);
        history.length = asked.historyLength;
      } else {
        discardEdit(editing);
        editing = undefined;
      }

      continue;
    }

    if (result === BACK) {
      const last = history.pop();

      if (!last) {
        return undefined;
      }

      // De vuelta desde la vista previa: si la misma respuesta vuelve a fallar, `finalize` vuelve a llevar al dueño.
      insisted.clear();
      ({ index, state } = last);
      continue;
    }

    if (retry && isDeepStrictEqual(retry.answer, result)) {
      insisted.add(retry.key);
    }

    if (result === NOT_ASKED) {
      answers.set(step.name, NOT_ASKED as Partial<S>);
    } else {
      if (editing) {
        editing.asked.add(index);
        editing.stack.push({ historyLength: history.length, index, state });
      }

      history.push({ index, state });
      answer(step, previous, result);
    }

    index += 1;
  }
}
