import type { WizardStep } from './wizard';

/**
 * Un dato que puede ser opcional en un contexto y obligatorio en otro (los datos del consumidor final: opcionales por
 * debajo del tope de la RG 5700/2025, obligatorios desde ahi). Es la base de `OptionalDef`.
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
