import type { InteractiveChoice } from '../../modules/interactive/choices';
import { optionalGroup, type OptionalGroupDef } from '../../modules/interactive/optional-group';
import type { WizardStep } from '../../modules/interactive/wizard';

import { chooseManyStep } from './prompts';

/** La pregunta de la seleccion de opcionales: la misma en todos los comprobantes. */
const OPTIONALS_MESSAGE = '¿Agregamos algún opcional? (espacio para marcar, Enter para seguir)';

export interface OptionalsStepDef<S, K extends string, O, C> extends Omit<
  OptionalGroupDef<S, K, O, C>,
  'message' | 'pick'
> {
  /** Como se muestra una opcion en la seleccion: por ejemplo, con la marca de nueva. */
  readonly decorate?: (choice: InteractiveChoice<K>) => InteractiveChoice<K>;
}

/**
 * Despues de lo requerido, una sola pregunta con todos los opcionales del catalogo (`options`): se marcan con espacio y
 * Enter sigue (sin marcar nada, todo queda por defecto). Despues se pregunta solo lo marcado, una pregunta por paso. Lo
 * marcado y lo respondido se recuerdan al volver a un paso anterior y regresar (REV-68); lo desmarcado vuelve a como
 * estaba (REV-65, REV-67). Lo comparten A, B, C y la E, cada una con su catalogo (`optionalGroup`).
 */
export function optionalsStep<S, K extends string, O, C>(def: OptionalsStepDef<S, K, O, C>): WizardStep<S> {
  const { decorate, ...group } = def;

  return optionalGroup({
    ...group,
    message: OPTIONALS_MESSAGE,
    pick: (message, choices, selected) => chooseManyStep(message, decorate ? choices.map(decorate) : choices, selected),
  });
}
