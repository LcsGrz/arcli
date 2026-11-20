import { InputValidationError } from '../errors/app-error';

/**
 * Lo que dice una regla que no se cumple. `message` es el texto del CLI, el mismo de siempre (con los flags), y `hint`
 * su sugerencia. `question` es el texto en el asistente si el del CLI nombra flags (REV-76): ahi se nombra la pregunta.
 */
export interface RuleFailure {
  readonly hint?: string;
  readonly message: string;
  readonly question?: string;
}

/**
 * Una regla entre campos de la entrada, la misma para el CLI (`assertRules`) y para las preguntas del asistente
 * (`ruleValidator`, en `modules/interactive`).
 */
export interface Rule<I, C> {
  /** Estable: `service-date-order`, `due-date-minimum`… */
  readonly id: string;
  /**
   * Campos de la entrada que escribe quien usa el CLI y que la regla lee, con `.` para los anidados
   * (`associatedPeriod.hasta`): en el asistente corre en cada pregunta que escribe uno, y `finalize` vuelve al paso que
   * escribe el primero que se respondio. Lo que no se pregunta (el comprobante, el concepto) va en la entrada igual.
   */
  readonly fields: readonly string[];
  /**
   * `undefined` si pasa o si falta un dato sin default en el CLI. Un dato mal escrito (una fecha invalida) lanza el
   * mismo error que el CLI, en el mismo orden.
   */
  readonly check: (input: Partial<I>, context: C) => RuleFailure | string | undefined;
}

function toFailure(result: RuleFailure | string): RuleFailure {
  return typeof result === 'string' ? { message: result } : result;
}

/** La primera regla de `rules`, en orden, que no se cumple. */
export function findRuleFailure<I, C>(
  rules: ReadonlyArray<Rule<I, C>>,
  input: Partial<I>,
  context: C,
): { readonly failure: RuleFailure; readonly rule: Rule<I, C> } | undefined {
  for (const rule of rules) {
    const result = rule.check(input, context);

    if (result !== undefined) {
      return { failure: toFailure(result), rule };
    }
  }

  return undefined;
}

/** Corre `rules` en orden: la primera que no se cumple lanza `InputValidationError` con su texto del CLI. */
export function assertRules<I, C>(rules: ReadonlyArray<Rule<I, C>>, input: Partial<I>, context: C): void {
  const found = findRuleFailure(rules, input, context);

  if (found) {
    throw new InputValidationError(found.failure.message, undefined, found.failure.hint);
  }
}
