import type { InteractiveChoice } from './choices';
import type { FieldDef } from './required-field';
import { BACK, type Back, runWizard, type WizardAnswers, type WizardDependency, type WizardStep } from './wizard';

/**
 * Un opcional del grupo: un dato (`FieldDef`) con lo que hace falta para mostrarlo en la seleccion y componerlo. Si
 * `required` da un motivo, el grupo no lo ofrece: lo pide `requiredOptional` como paso propio.
 */
export interface OptionalDef<K extends string, O, C> extends FieldDef<O, C> {
  readonly key: K;
  readonly label: string;
  /** Descripcion en la seleccion, de los valores aplicados. */
  readonly describe: (current: O, context: C) => string;
  /**
   * Campos de O que son de este opcional: solo esos se aplican, vuelven a `initial` al desmarcarlo y se limpian si deja
   * de estar disponible.
   */
  readonly owns: ReadonlyArray<keyof O & string>;
  /** Valor de `owns` cuando no esta disponible. Por defecto, el de `initial`. */
  readonly cleared?: (initial: O) => Partial<O>;
}

export interface OptionalGroupDef<S, K extends string, O, C> {
  /** Nombre del paso en el asistente de afuera. */
  readonly name: string;
  /** La pregunta de la seleccion, que recibe `pick`. */
  readonly message: string;
  /** Los valores de los opcionales antes del grupo: de ahi arranca cada respuesta y a eso vuelve lo desmarcado. */
  readonly read: (state: S) => O;
  readonly write: (value: O) => Partial<S>;
  readonly context: (state: S) => C;
  readonly options: ReadonlyArray<OptionalDef<K, O, C>>;
  /** Lo que arranca marcado mientras no se confirmo ninguna seleccion. */
  readonly preselected?: (context: C) => readonly K[];
  readonly dependsOn?: readonly WizardDependency[];
  /** La seleccion multiple: la inyecta `cli` (`chooseManyStep`). */
  readonly pick: (
    message: string,
    choices: ReadonlyArray<InteractiveChoice<K>>,
    selected: readonly K[],
  ) => Promise<Back | K[]>;
}

/**
 * Memo del grupo, que comparte con `requiredOptional`: las respuestas internas (REV-68) y el memo de cada pregunta
 * interna (por ejemplo, los items de la E a medio cargar).
 */
export interface OptionalGroupMemo<K, O> {
  readonly answers: WizardAnswers<O>;
  /** Lo que cuenta para el resultado: lo elegido en la seleccion y lo respondido como obligatorio. */
  readonly marked: readonly K[];
  readonly memos: Map<string, unknown>;
  /** Lo elegido en la seleccion; `undefined` mientras no se confirmo ninguna (arranca con `preselected`). */
  readonly picked?: readonly K[];
}

function emptyMemo<K, O>(): OptionalGroupMemo<K, O> {
  return { answers: new Map(), marked: [], memos: new Map() };
}

function pickOwned<O>(value: O, owns: ReadonlyArray<keyof O & string>): Partial<O> {
  return Object.fromEntries(owns.map((key) => [key, value[key]])) as Partial<O>;
}

function isRequired<K extends string, O, C>(option: OptionalDef<K, O, C>, context: C): boolean {
  return option.required?.(context) !== undefined;
}

/** Las claves de `keys` que estan en `options` y disponibles, sin repetir y en el orden del catalogo. */
function keepAvailable<K extends string, O, C>(
  options: ReadonlyArray<OptionalDef<K, O, C>>,
  keys: readonly K[],
  context: C,
): K[] {
  return options.filter((option) => keys.includes(option.key) && option.available(context)).map((option) => option.key);
}

/**
 * Las preguntas de los opcionales se corren juntas en un asistente anidado: un nombre repetido mezclaria respuestas, y
 * una pregunta que depende de otro opcional se rompe si ese no esta marcado. Como las preguntas salen del contexto, se
 * controla con el contexto de cada corrida y con todos los opcionales (no solo lo marcado), asi falla siempre igual.
 */
function assertCatalog<K extends string, O, C>(
  group: string,
  options: ReadonlyArray<OptionalDef<K, O, C>>,
  context: C,
): void {
  const owner = new Map<string, K>();
  const stepsOf = options.map((option) => ({ option, steps: option.steps(context) }));

  for (const { option, steps } of stepsOf) {
    for (const step of steps) {
      const other = owner.get(step.name);

      if (other !== undefined) {
        throw new Error(
          `En el grupo ${group}, la pregunta ${step.name} esta en los opcionales ${other} y ${option.key}.`,
        );
      }

      owner.set(step.name, option.key);
    }
  }

  for (const { option, steps } of stepsOf) {
    for (const step of steps) {
      for (const dependency of step.dependsOn ?? []) {
        const name = typeof dependency === 'string' ? dependency : dependency.step;
        const other = owner.get(name);

        if (other !== undefined && other !== option.key) {
          throw new Error(
            `En el grupo ${group}, la pregunta ${step.name} del opcional ${option.key} depende de ${name}, del opcional ${other}.`,
          );
        }
      }
    }
  }
}

/**
 * Las respuestas de `steps` sobre `from`, como si se confirmara cada pregunta con lo que ofrece. `undefined` si alguna
 * que aplica no tiene respuesta: el opcional esta a medias.
 */
function replay<O>(steps: ReadonlyArray<WizardStep<O>>, from: O, answers: WizardAnswers<O>): O | undefined {
  let answered = from;

  for (const step of steps) {
    if (step.skip?.(answered)) {
      continue;
    }

    const answer = answers.get(step.name);

    if (!answer) {
      return undefined;
    }

    answered = { ...answered, ...answer };
  }

  return answered;
}

/**
 * Lo que vale el grupo con lo marcado y lo respondido: `initial`, con los `owns` de cada opcional marcado, disponible y
 * completo (todas sus preguntas que aplican respondidas), en el orden del catalogo, y los `owns` de cada opcional no
 * disponible en `cleared`. Lo desmarcado o a medias queda como en `initial`.
 */
export function composeOptionals<K extends string, O, C>(
  initial: O,
  marked: readonly K[],
  options: ReadonlyArray<OptionalDef<K, O, C>>,
  context: C,
  answers: WizardAnswers<O>,
): O {
  const markedKeys = new Set(marked);
  let composed = initial;

  for (const option of options) {
    if (!markedKeys.has(option.key) || !option.available(context)) {
      continue;
    }

    const answered = replay(option.steps(context), composed, answers);

    if (answered) {
      composed = { ...composed, ...pickOwned(answered, option.owns) };
    }
  }

  for (const option of options) {
    if (!option.available(context)) {
      composed = { ...composed, ...(option.cleared?.(initial) ?? pickOwned(initial, option.owns)) };
    }
  }

  return composed;
}

/**
 * Un paso con todos los opcionales en una seleccion multiple: se marcan y Enter pregunta solo lo marcado, en el orden
 * del catalogo, desde `initial` y con las respuestas de antes (cada pregunta arranca escrita y revalida con el contexto
 * actual). "Volver" en la primera pregunta vuelve a la seleccion; en la seleccion, al paso anterior. Lo marcado y lo
 * respondido quedan en el memo del paso, asi sobreviven a volver y avanzar (REV-68); lo que ya no esta disponible se
 * desmarca. Lo obligatorio no se ofrece (lo pide `requiredOptional`) pero sigue marcado. El resultado es
 * `composeOptionals`: lo desmarcado vuelve a `initial` (REV-65, REV-67). Sin nada para ofrecer, no pregunta y aplica
 * `composeOptionals` igual (los `cleared`), sin entrar en la historia.
 */
export function optionalGroup<S, K extends string, O, C>(def: OptionalGroupDef<S, K, O, C>): WizardStep<S> {
  const offeredIn = (context: C) =>
    def.options.filter((option) => option.available(context) && !isRequired(option, context));
  const requiredIn = (keys: readonly K[], context: C): K[] =>
    def.options
      .filter((option) => keys.includes(option.key) && isRequired(option, context))
      .map((option) => option.key);

  return {
    auto: (state, memo) => {
      const context = def.context(state);

      if (offeredIn(context).length > 0) {
        return undefined;
      }

      assertCatalog(def.name, def.options, context);

      const remembered = memo.get<OptionalGroupMemo<K, O>>() ?? emptyMemo<K, O>();
      const marked = keepAvailable(def.options, remembered.marked, context);

      memo.set<OptionalGroupMemo<K, O>>({ ...remembered, marked });

      return def.write(composeOptionals(def.read(state), marked, def.options, context, remembered.answers));
    },
    dependsOn: def.dependsOn,
    name: def.name,
    run: async (state, _previous, memo) => {
      const initial = def.read(state);
      const context = def.context(state);

      assertCatalog(def.name, def.options, context);

      const offered = offeredIn(context);
      const { answers, memos, ...remembered } = memo.get<OptionalGroupMemo<K, O>>() ?? emptyMemo<K, O>();
      let picked = remembered.picked;
      let marked = keepAvailable(
        def.options,
        picked === undefined ? [...remembered.marked, ...(def.preselected?.(context) ?? [])] : remembered.marked,
        context,
      );

      for (;;) {
        const shown = composeOptionals(initial, marked, def.options, context, answers);
        const selection = await def.pick(
          def.message,
          offered.map((option) => ({
            description: option.describe(shown, context),
            name: option.label,
            value: option.key,
          })),
          keepAvailable(offered, marked, context),
        );

        if (selection === BACK) {
          return BACK;
        }

        const chosen = keepAvailable(offered, selection, context);

        // Lo obligatorio no estaba en la seleccion: sigue como estaba.
        picked = keepAvailable(def.options, [...chosen, ...requiredIn(picked ?? [], context)], context);
        marked = keepAvailable(def.options, [...chosen, ...requiredIn(marked, context)], context);
        memo.set<OptionalGroupMemo<K, O>>({ answers, marked, memos, picked });

        const done = await runWizard(
          offered.filter((option) => chosen.includes(option.key)).flatMap((option) => option.steps(context)),
          initial,
          answers,
          { memos },
        );

        if (done) {
          return def.write(composeOptionals(initial, marked, def.options, context, answers));
        }
      }
    },
  };
}

export interface RequiredOptionalDef<K extends string> {
  /** El opcional del grupo que se pide. */
  readonly key: K;
  /** Nombre del paso: unico, porque el mismo dato se puede pedir en dos puntos del flujo. */
  readonly name: string;
  /** Muestra el motivo antes de preguntar: lo inyecta `cli`. */
  readonly notice: (reason: string) => void;
  readonly dependsOn?: readonly WizardDependency[];
}

/**
 * Un opcional del grupo como pregunta obligatoria, con su motivo (`required`): solo mientras es obligatorio y no se
 * respondio como opcional. Lo respondido queda en el memo del grupo (`memoOf`) y se marca: si deja de ser obligatorio,
 * el grupo lo muestra como opcional marcado y con lo escrito. Escribe solo los `owns` del opcional.
 */
export function requiredOptional<S, K extends string, O, C>(
  group: OptionalGroupDef<S, K, O, C>,
  def: RequiredOptionalDef<K>,
): WizardStep<S> {
  const option = group.options.find((candidate) => candidate.key === def.key);

  if (!option) {
    throw new Error(`El grupo ${group.name} no tiene el opcional ${def.key}.`);
  }

  const reasonFor = (context: C) => (option.available(context) ? option.required?.(context) : undefined);

  return {
    dependsOn: def.dependsOn,
    memoOf: group.name,
    name: def.name,
    run: async (state, _previous, memo) => {
      const context = group.context(state);
      const initial = group.read(state);

      assertCatalog(group.name, group.options, context);

      const remembered = memo.get<OptionalGroupMemo<K, O>>() ?? emptyMemo<K, O>();

      memo.set(remembered);
      def.notice(reasonFor(context)?.reason ?? '');

      const done = await runWizard(option.steps(context), initial, remembered.answers, { memos: remembered.memos });

      if (!done) {
        return BACK;
      }

      memo.set<OptionalGroupMemo<K, O>>({
        ...remembered,
        marked: keepAvailable(group.options, [...remembered.marked, def.key], context),
      });

      return group.write({ ...initial, ...pickOwned(done, option.owns) });
    },
    // Respondido como opcional: elegido en la seleccion y completo. No mira lo que marca este paso, asi "Volver" desde
    // el siguiente lo vuelve a preguntar.
    skip: (state, memo) => {
      const context = group.context(state);
      const remembered = memo?.get<OptionalGroupMemo<K, O>>();

      return (
        reasonFor(context) === undefined ||
        (remembered?.picked?.includes(def.key) === true &&
          replay(option.steps(context), group.read(state), remembered.answers) !== undefined)
      );
    },
  };
}
