import { InputValidationError } from '../../lib/errors/app-error';
import { findRuleFailure, type Rule } from '../../lib/rules/rules';

import type { WizardFinalize } from './wizard';

/**
 * Las reglas de la entrada vistas desde una pregunta: `draft` arma la entrada del CLI con lo respondido hasta ahi mas
 * lo que escribe la pregunta (`patch`), y `context` es el de las reglas (hoy, el comprobante, el CUIT emisor…). Lo que
 * todavia no se pregunto queda como en el CLI sin el flag. `context` se pide en cada validacion: una lista que queda
 * abierta al pasar la medianoche usa el dia nuevo (ARQ-19).
 */
export interface RuleScope<I, C> {
  readonly context: () => C;
  readonly draft: (patch: Partial<I>) => Partial<I>;
}

/** El texto de una regla en el asistente: el de la pregunta si el del CLI nombra flags (REV-76). */
function questionText<I, C>(rules: ReadonlyArray<Rule<I, C>>, input: Partial<I>, context: C): string | undefined {
  try {
    const found = findRuleFailure(rules, input, context);

    return found ? (found.failure.question ?? found.failure.message) : undefined;
  } catch (error) {
    // Una fecha mal escrita la frena el validador de la pregunta antes; si igual llega, con el texto del CLI.
    if (error instanceof InputValidationError) {
      return error.message;
    }

    throw error;
  }
}

/**
 * El validador de una pregunta de texto con las reglas que leen `field` (`Rule.fields`): primero `validate` (el formato
 * de la pregunta) y, si pasa, cada regla con la entrada que arma `draft` (lo respondido y el candidato). Devuelve el
 * texto de la primera regla que falla, nombrando la pregunta y no el flag (REV-76), o `true`.
 */
export function ruleValidator<S, I, C>(options: {
  readonly rules: ReadonlyArray<Rule<I, C>>;
  readonly field: string;
  readonly draft: (state: S, candidate: string) => Partial<I>;
  readonly context: (state: S) => C;
  readonly validate?: (value: string) => string | true;
}): (state: S) => (value: string) => string | true {
  const rules = options.rules.filter((rule) => rule.fields.includes(options.field));

  return (state) => (value) => {
    const valid = options.validate?.(value) ?? true;

    if (valid !== true) {
      return valid;
    }

    return questionText(rules, options.draft(state, value), options.context(state)) ?? true;
  };
}

/** `ruleValidator` sobre un `RuleScope`: `patch` arma lo que escribe la pregunta con el texto ya validado. */
export function scopedRuleValidator<I, C>(
  rules: ReadonlyArray<Rule<I, C>>,
  field: string,
  scope: RuleScope<I, C>,
  patch: (value: string) => Partial<I>,
  validate?: (value: string) => string | true,
): (value: string) => string | true {
  return ruleValidator<RuleScope<I, C>, I, C>({
    context: (current) => current.context(),
    draft: (current, candidate) => current.draft(patch(candidate)),
    field,
    rules,
    validate,
  })(scope);
}

/**
 * `finalize` del asistente con las reglas: corre todas sobre la entrada final (`draft`; `undefined` si no hay entrada,
 * por ejemplo si se eligio la E) y, si una falla, vuelve al paso que escribe uno de sus campos con el texto de la
 * pregunta.
 */
export function rulesFinalize<S, I, C>(options: {
  readonly rules: ReadonlyArray<Rule<I, C>>;
  readonly draft: (state: S) => Partial<I> | undefined;
  readonly context: (state: S) => C;
}): WizardFinalize<S> {
  return (state) => {
    const input = options.draft(state);

    if (!input) {
      return undefined;
    }

    try {
      const found = findRuleFailure(options.rules, input, options.context(state));

      return found ? { field: found.rule.fields, message: found.failure.question ?? found.failure.message } : undefined;
    } catch (error) {
      // Un dato mal escrito no es de una regla: queda para la vista previa, con el texto del CLI.
      if (error instanceof InputValidationError) {
        return undefined;
      }

      throw error;
    }
  };
}
