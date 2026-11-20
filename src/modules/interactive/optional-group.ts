import type { InteractiveChoice } from './choices';
import { BACK, type Back, runWizard, type WizardAnswers, type WizardDependency, type WizardStep } from './wizard';

/** Un opcional del grupo: cuando se ofrece, que campos son suyos y sus preguntas. */
export interface OptionalDef<K extends string, O, C> {
  readonly key: K;
  readonly label: string;
  /** Si se ofrece con el contexto actual (letra, concepto, FCE, oculto en notas…). */
  readonly available: (context: C) => boolean;
  /** Descripcion en la seleccion, de los valores aplicados. */
  readonly describe: (current: O, context: C) => string;
  /**
   * Campos de O que son de este opcional: solo esos se aplican, vuelven a `initial` al desmarcarlo y se limpian si deja
   * de estar disponible.
   */
  readonly owns: ReadonlyArray<keyof O & string>;
  /** Valor de `owns` cuando no esta disponible. Por defecto, el de `initial`. */
  readonly cleared?: (initial: O) => Partial<O>;
  /** Preguntas del opcional, con el contexto del padre (monto, fecha, asociado) para validar. */
  readonly steps: (context: C) => ReadonlyArray<WizardStep<O>>;
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
  /** Lo que arranca marcado la primera vez. */
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
 * Memo del grupo: lo marcado y las respuestas internas (REV-68), y el memo de cada pregunta interna (por ejemplo, los
 * items de la E a medio cargar).
 */
export interface OptionalGroupMemo<K, O> {
  readonly answers: WizardAnswers<O>;
  readonly marked: readonly K[];
  readonly memos: Map<string, unknown>;
}

function pickOwned<O>(value: O, owns: ReadonlyArray<keyof O & string>): Partial<O> {
  return Object.fromEntries(owns.map((key) => [key, value[key]])) as Partial<O>;
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
 * desmarca. El resultado es `composeOptionals`: lo desmarcado vuelve a `initial` (REV-65, REV-67).
 */
export function optionalGroup<S, K extends string, O, C>(def: OptionalGroupDef<S, K, O, C>): WizardStep<S> {
  return {
    dependsOn: def.dependsOn,
    name: def.name,
    run: async (state, _previous, memo) => {
      const initial = def.read(state);
      const context = def.context(state);
      const offered = def.options.filter((option) => option.available(context));
      const remembered = memo.get<OptionalGroupMemo<K, O>>();
      const answers: WizardAnswers<O> = remembered?.answers ?? new Map();
      const memos = remembered?.memos ?? new Map<string, unknown>();
      // En el orden del catalogo y solo lo disponible.
      const markable = (keys: readonly K[]): K[] =>
        offered.filter((option) => keys.includes(option.key)).map((option) => option.key);
      let marked = markable(remembered?.marked ?? def.preselected?.(context) ?? []);

      for (;;) {
        memo.set<OptionalGroupMemo<K, O>>({ answers, marked, memos });

        const shown = composeOptionals(initial, marked, def.options, context, answers);
        const picked = await def.pick(
          def.message,
          offered.map((option) => ({
            description: option.describe(shown, context),
            name: option.label,
            value: option.key,
          })),
          marked,
        );

        if (picked === BACK) {
          return BACK;
        }

        marked = markable(picked);
        memo.set<OptionalGroupMemo<K, O>>({ answers, marked, memos });

        const done = await runWizard(
          offered.filter((option) => marked.includes(option.key)).flatMap((option) => option.steps(context)),
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
