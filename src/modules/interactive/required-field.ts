import { BACK, runWizard, type WizardAnswers, type WizardDependency, type WizardStep } from './wizard';

/**
 * Un dato que es opcional en un contexto y obligatorio en otro (los datos del consumidor final: opcionales por debajo
 * del tope de la RG 5700/2025, obligatorios desde ahi). Se declara una vez: `key`, `available` y `steps` son los de su
 * opcional (`OptionalDef`), y `requiredField` lo pide como pregunta obligatoria cuando hace falta.
 */
export interface FieldDef<S, O, C> {
  readonly key: string;
  /** Cuando se ofrece (como `available` de un opcional). */
  readonly available: (context: C) => boolean;
  /** Cuando es obligatorio, con el motivo que se muestra (por ejemplo, el tope de la RG 5700/2025). */
  readonly required?: (state: S) => { readonly reason: string } | undefined;
  /** Si ya esta respondido, como opcional o como obligatorio. */
  readonly answered: (state: S) => boolean;
  readonly steps: (context: C) => ReadonlyArray<WizardStep<O>>;
}

export interface RequiredFieldDef<S, O, C> {
  readonly field: FieldDef<S, O, C>;
  /** Nombre del paso: unico, porque el mismo dato se puede pedir en dos puntos del flujo. */
  readonly name: string;
  readonly read: (state: S) => O;
  readonly write: (value: O) => Partial<S>;
  readonly context: (state: S) => C;
  /** Muestra el motivo antes de preguntar: lo inyecta `cli`. */
  readonly notice: (reason: string) => void;
  readonly dependsOn?: readonly WizardDependency[];
}

/** Lo que recuerda el paso: las respuestas de sus preguntas y el memo de cada una. */
interface RequiredFieldMemo<O> {
  readonly answers: WizardAnswers<O>;
  readonly memos: Map<string, unknown>;
}

/**
 * El dato como pregunta obligatoria, con su motivo: solo si se ofrece, es obligatorio y todavia no esta respondido. Si
 * ya se respondio como opcional, no se vuelve a pedir. "Volver" en la primera pregunta vuelve al paso anterior.
 */
export function requiredField<S, O, C>(def: RequiredFieldDef<S, O, C>): WizardStep<S> {
  const { field } = def;

  return {
    dependsOn: def.dependsOn,
    name: def.name,
    run: async (state, _previous, memo) => {
      const reason = field.required?.(state);
      const remembered = memo.get<RequiredFieldMemo<O>>() ?? { answers: new Map(), memos: new Map() };

      memo.set(remembered);

      if (reason) {
        def.notice(reason.reason);
      }

      const done = await runWizard(field.steps(def.context(state)), def.read(state), remembered.answers, {
        memos: remembered.memos,
      });

      return done === undefined ? BACK : def.write(done);
    },
    skip: (state) => !field.available(def.context(state)) || !field.required?.(state) || field.answered(state),
  };
}
