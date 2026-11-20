import { isDeepStrictEqual } from 'node:util';

import type { InteractiveChoice } from './choices';
import type { FieldDef } from './required-field';
import {
  BACK,
  type Back,
  dependentsOf,
  runWizard,
  type StepMemo,
  stepMemo,
  type WizardAnswers,
  type WizardDependency,
  type WizardStep,
} from './wizard';

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
  /**
   * De que parte del contexto sale su valor inicial (por ejemplo, la alicuota copiada de la factura que se repite), como
   * una clave. Si al volver a correr el grupo la clave cambio, este opcional, y solo este, olvida su marca y sus
   * respuestas y vuelve a arrancar como la primera vez (con `preselected`).
   */
  readonly resetWhen?: (context: C) => string;
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
  /** La clave de `resetWhen` de cada opcional que la declara, la ultima vez que corrio el grupo. */
  readonly resetKeys?: ReadonlyMap<K, string>;
}

function emptyMemo<K, O>(): OptionalGroupMemo<K, O> {
  return { answers: new Map(), marked: [], memos: new Map() };
}

/**
 * El memo con lo que cambio de contexto olvidado: cada opcional cuya clave de `resetWhen` no es la recordada pierde su
 * marca, sus respuestas y los memos de sus preguntas, y si esta en `preselected` vuelve a arrancar marcado. Guarda las
 * claves actuales. Los demas opcionales quedan como estaban. No toca `remembered`: devuelve un memo nuevo (con sus
 * propios mapas), asi `skip` lo puede mirar sin olvidar nada.
 */
function forgetChanged<K extends string, O, C>(
  options: ReadonlyArray<OptionalDef<K, O, C>>,
  remembered: OptionalGroupMemo<K, O>,
  context: C,
  preselected: readonly K[],
): OptionalGroupMemo<K, O> {
  const resetKeys = new Map<K, string>();

  for (const option of options) {
    if (option.resetWhen) {
      resetKeys.set(option.key, option.resetWhen(context));
    }
  }

  const changed = options.filter((option) => {
    const before = remembered.resetKeys?.get(option.key);

    return before !== undefined && before !== resetKeys.get(option.key);
  });
  const reset = new Set(changed.map((option) => option.key));
  const answers = new Map(remembered.answers);
  const memos = new Map(remembered.memos);

  for (const option of changed) {
    for (const step of option.steps(context)) {
      answers.delete(step.name);
      memos.delete(step.name);
    }
  }

  const kept = (keys: readonly K[]) => keys.filter((key) => !reset.has(key));

  return {
    answers,
    marked: [...kept(remembered.marked), ...preselected.filter((key) => reset.has(key))],
    memos,
    picked: remembered.picked && kept(remembered.picked),
    resetKeys,
  };
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
 * `composeOptionals` igual (los `cleared`), sin entrar en la historia. Escribe (`writes`) los `owns` de lo marcado: si
 * `finalize` vuelve por uno, el grupo retoma en la pregunta que lo escribe (la que lo declara en su `writes`), con lo
 * marcado y sin pasar por la seleccion.
 */
export function optionalGroup<S, K extends string, O, C>(def: OptionalGroupDef<S, K, O, C>): WizardStep<S> {
  const offeredIn = (context: C) =>
    def.options.filter((option) => option.available(context) && !isRequired(option, context));
  const requiredIn = (keys: readonly K[], context: C): K[] =>
    def.options
      .filter((option) => keys.includes(option.key) && isRequired(option, context))
      .map((option) => option.key);

  return {
    // Para `finalize`: los campos de lo marcado (los de lo desmarcado quedan como en `initial`).
    writes: (state, memo) => {
      const marked = memo.get<OptionalGroupMemo<K, O>>()?.marked ?? [];
      const context = def.context(state);

      return def.options
        .filter((option) => marked.includes(option.key) && option.available(context))
        .flatMap((option) => option.owns);
    },
    auto: (state, memo) => {
      const context = def.context(state);

      if (offeredIn(context).length > 0) {
        return undefined;
      }

      assertCatalog(def.name, def.options, context);

      const remembered = forgetChanged(
        def.options,
        memo.get<OptionalGroupMemo<K, O>>() ?? emptyMemo<K, O>(),
        context,
        def.preselected?.(context) ?? [],
      );
      const marked = keepAvailable(def.options, remembered.marked, context);

      memo.set<OptionalGroupMemo<K, O>>({ ...remembered, marked });

      return def.write(composeOptionals(def.read(state), marked, def.options, context, remembered.answers));
    },
    dependsOn: def.dependsOn,
    name: def.name,
    run: async (state, _previous, memo, error, failedFields) => {
      const initial = def.read(state);
      const context = def.context(state);

      assertCatalog(def.name, def.options, context);

      const offered = offeredIn(context);
      const refreshed = forgetChanged(
        def.options,
        memo.get<OptionalGroupMemo<K, O>>() ?? emptyMemo<K, O>(),
        context,
        def.preselected?.(context) ?? [],
      );

      // Las claves quedan guardadas aunque se vuelva sin confirmar: lo olvidado no se vuelve a olvidar.
      memo.set(refreshed);

      const { answers, memos, resetKeys, ...remembered } = refreshed;
      let picked = remembered.picked;
      let marked = keepAvailable(
        def.options,
        picked === undefined ? [...remembered.marked, ...(def.preselected?.(context) ?? [])] : remembered.marked,
        context,
      );

      // Volvio por un error de `finalize` en un campo de lo marcado: retoma en la pregunta que lo escribe, con lo marcado.
      let resume = error && failedFields ? { fields: failedFields, message: error } : undefined;

      for (;;) {
        if (resume) {
          const chosen = keepAvailable(offered, marked, context);
          const done = await runWizard(
            offered.filter((option) => chosen.includes(option.key)).flatMap((option) => option.steps(context)),
            initial,
            answers,
            { memos, resume },
          );

          resume = undefined;

          if (done) {
            return def.write(composeOptionals(initial, marked, def.options, context, answers));
          }
        }

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
        memo.set<OptionalGroupMemo<K, O>>({ answers, marked, memos, picked, resetKeys });

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

export interface RequiredOptionalDef<S, K extends string, O, C> {
  /** El opcional del grupo que se pide. */
  readonly key: K;
  /**
   * Prefijo de los pasos (`cf` da `cf:consumidor-documento`): unico, porque el mismo dato se puede pedir en dos puntos
   * del flujo.
   */
  readonly name: string;
  /**
   * Las preguntas del opcional que se piden, por nombre y en su orden: cada una es un paso del asistente, asi "Volver"
   * lleva a la anterior y, desde la primera, al paso anterior del flujo.
   */
  readonly questions: readonly string[];
  /** Muestra el motivo antes de la primera pregunta: lo inyecta `cli`. */
  readonly notice: (reason: string) => void;
  /** Si el dato ya esta en los valores del grupo (por ejemplo, pedido en un punto anterior del flujo): no se pide. */
  readonly answered?: (value: O) => boolean;
  /** El contexto, si no es el del grupo: por ejemplo, con algo que se consulto despues de los opcionales. */
  readonly context?: (state: S) => C;
  /**
   * Cuando todavia no se sabe si es obligatorio sin consultar algo (la cotizacion oficial de ARCA): mientras `when`, la
   * primera pregunta corre `resolve` antes de preguntar y, si con eso no es obligatorio, sigue sin preguntar.
   */
  readonly pending?: {
    readonly resolve: (state: S) => Promise<void>;
    readonly when: (state: S) => boolean;
  };
}

/** La pregunta `name` del opcional con el contexto actual: si no esta, el flujo esta mal armado. */
function questionOf<K extends string, O, C>(option: OptionalDef<K, O, C>, context: C, name: string): WizardStep<O> {
  const step = option.steps(context).find((candidate) => candidate.name === name);

  if (!step) {
    throw new Error(`El opcional ${option.key} no tiene la pregunta ${name}.`);
  }

  return step;
}

/**
 * Un opcional del grupo como preguntas obligatorias, con su motivo (`required`): solo mientras es obligatorio y no esta
 * respondido (en los valores del grupo, `answered`, o elegido en la seleccion y completo). Un paso del asistente por
 * pregunta (`questions`). Lo respondido queda en el memo del grupo (`memoOf`): al volver, cada pregunta arranca con lo
 * escrito, y lo que cambia de contexto (`resetWhen`) se olvida igual que en el grupo, tambien para decidir si se
 * saltea. Con todas respondidas se marca: si deja de ser obligatorio, el grupo lo muestra como opcional marcado y con
 * lo escrito. Cada paso escribe solo los `owns` del opcional.
 */
export function requiredOptional<S, K extends string, O, C>(
  group: OptionalGroupDef<S, K, O, C>,
  def: RequiredOptionalDef<S, K, O, C>,
): Array<WizardStep<S>> {
  const option = group.options.find((candidate) => candidate.key === def.key);

  if (!option) {
    throw new Error(`El grupo ${group.name} no tiene el opcional ${def.key}.`);
  }

  const contextOf = def.context ?? group.context;
  const reasonFor = (context: C) => (option.available(context) ? option.required?.(context) : undefined);
  const refreshed = (memo: StepMemo | undefined, context: C) =>
    forgetChanged(
      group.options,
      memo?.get<OptionalGroupMemo<K, O>>() ?? emptyMemo<K, O>(),
      context,
      group.preselected?.(context) ?? [],
    );
  /** Respondido: en los valores del grupo, o elegido en la seleccion y completo (sin mirar lo que marcan estos pasos). */
  const isAnswered = (state: S, memo: StepMemo | undefined, context: C) => {
    const remembered = refreshed(memo, context);

    return (
      def.answered?.(group.read(state)) === true ||
      (remembered.picked?.includes(def.key) === true &&
        replay(option.steps(context), group.read(state), remembered.answers) !== undefined)
    );
  };

  return def.questions.map((question, index): WizardStep<S> => {
    const first = index === 0;

    return {
      memoOf: group.name,
      name: `${def.name}:${question}`,
      run: async (state, _previous, memo, error, failedFields) => {
        let context = contextOf(state);

        // Recien con la consulta se sabe si es obligatorio: si no lo es, sigue sin preguntar.
        if (first && reasonFor(context) === undefined && def.pending?.when(state)) {
          await def.pending.resolve(state);
          context = contextOf(state);

          if (reasonFor(context) === undefined) {
            return {};
          }
        }

        assertCatalog(group.name, group.options, context);

        const remembered = refreshed(memo, context);

        memo.set(remembered);

        if (first) {
          def.notice(reasonFor(context)?.reason ?? '');
        }

        const current = group.read(state);
        const steps = option.steps(context);
        const before = remembered.answers.get(question);
        const result = await questionOf(option, context, question).run(
          current,
          before,
          stepMemo(remembered.memos, question),
          error,
          failedFields,
        );

        if (result === BACK) {
          return BACK;
        }

        // Como en el asistente: si la respuesta cambio, las preguntas que dependen de ella olvidan la suya.
        if (!isDeepStrictEqual(before, result)) {
          for (const name of dependentsOf(steps, question, before, result)) {
            remembered.answers.delete(name);
            remembered.memos.delete(name);
          }
        }

        remembered.answers.set(question, result);

        const complete = replay(steps, current, remembered.answers) !== undefined;

        memo.set<OptionalGroupMemo<K, O>>({
          ...remembered,
          marked: complete ? keepAvailable(group.options, [...remembered.marked, def.key], context) : remembered.marked,
        });

        return group.write({ ...current, ...pickOwned({ ...current, ...result }, option.owns) });
      },
      skip: (state, memo) => {
        const context = contextOf(state);

        if (reasonFor(context) === undefined && !(first && def.pending?.when(state))) {
          return true;
        }

        return (
          isAnswered(state, memo, context) || Boolean(questionOf(option, context, question).skip?.(group.read(state)))
        );
      },
      writes: (state, memo) => {
        const writes = questionOf(option, contextOf(state), question).writes;

        return typeof writes === 'function'
          ? writes(group.read(state), stepMemo(refreshed(memo, contextOf(state)).memos, question))
          : (writes ?? []);
      },
    };
  });
}
