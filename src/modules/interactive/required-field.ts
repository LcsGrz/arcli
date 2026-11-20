import { BACK, runWizard, type WizardAnswers, type WizardDependency, type WizardStep } from './wizard';

/**
 * Un dato que puede ser opcional en un contexto y obligatorio en otro (los datos del consumidor final: opcionales por
 * debajo del tope de la RG 5700/2025, obligatorios desde ahi). Es la base de `OptionalDef`; solo, sirve para un dato
 * obligatorio fuera de un grupo de opcionales (`requiredField`).
 */
export interface FieldDef<O, C> {
  readonly key: string;
  /** Cuando se ofrece (letra, concepto, receptor…). */
  readonly available: (context: C) => boolean;
  /** Cuando es obligatorio, con el motivo que se muestra (por ejemplo, el tope de la RG 5700/2025). */
  readonly required?: (context: C) => { readonly reason: string } | undefined;
  /** Sus preguntas, con el contexto del padre (monto, fecha, asociado) para validar. */
  readonly steps: (context: C) => ReadonlyArray<WizardStep<O>>;
}

export interface RequiredFieldDef<S, O, C> {
  readonly field: FieldDef<O, C>;
  /** Nombre del paso: unico, porque el mismo dato se puede pedir en dos puntos del flujo. */
  readonly name: string;
  readonly read: (state: S) => O;
  readonly write: (value: O) => Partial<S>;
  readonly context: (state: S) => C;
  /** Si ya esta respondido (por ejemplo, copiado de la factura que se repite): no se vuelve a pedir. */
  readonly answered: (state: S) => boolean;
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
 * Un dato fuera de un grupo de opcionales como pregunta obligatoria, con su motivo: solo si se ofrece, es obligatorio y
 * todavia no esta respondido. Para un opcional de un grupo, `requiredOptional`. "Volver" en la primera pregunta vuelve
 * al paso anterior.
 */
export function requiredField<S, O, C>(def: RequiredFieldDef<S, O, C>): WizardStep<S> {
  const { field } = def;
  const reasonFor = (state: S) => {
    const context = def.context(state);

    return field.available(context) ? field.required?.(context) : undefined;
  };

  return {
    dependsOn: def.dependsOn,
    name: def.name,
    run: async (state, _previous, memo) => {
      const remembered = memo.get<RequiredFieldMemo<O>>() ?? { answers: new Map(), memos: new Map() };

      memo.set(remembered);
      def.notice(reasonFor(state)?.reason ?? '');

      const done = await runWizard(field.steps(def.context(state)), def.read(state), remembered.answers, {
        memos: remembered.memos,
      });

      return done === undefined ? BACK : def.write(done);
    },
    skip: (state) => reasonFor(state) === undefined || def.answered(state),
  };
}
