import { BILLING_RULES } from '../../../modules/billing/billing.rules';
import { amountInputText, parseAmountInput } from '../../../modules/interactive/amount-input';
import type { BillingRuleScope } from '../../../modules/interactive/billing-optionals';
import { scopedRuleValidator } from '../../../modules/interactive/rule-validator';
import type { Lens } from '../../../modules/interactive/steps/lens';
import { BACK, type WizardDependency, type WizardStep } from '../../../modules/interactive/wizard';
import { askTextStep } from '../prompts';
import { validateAmount } from '../validators';

export interface AmountStepDef<S> {
  /** Por defecto, `monto`. */
  readonly name?: string;
  readonly amount: Lens<S, number>;
  /** La pregunta: con la moneda si no es pesos (`amountQuestion`), o la de la nota. */
  readonly message: (state: S) => string;
  /** El validador con lo que el flujo sabe (el tope de la NC, las reglas); por defecto, el formato del monto. */
  readonly validate?: (state: S) => (value: string) => string | true;
  /** Lo que escribe ademas del monto (por ejemplo, descartar lo que dependia del monto anterior). */
  readonly write?: (amount: number | undefined, state: S) => Partial<S>;
  readonly dependsOn?: readonly WizardDependency[];
  readonly skip?: (state: S) => boolean;
  /** Los campos de la entrada que escribe, para `finalize`. */
  readonly writes?: readonly string[];
}

/**
 * El monto, escrito como en los flags (`1.500,50`) y validado igual. Al volver arranca escrito. Lo comparten "Emitir
 * factura" y "Emitir recibo", las notas, "Repetir" y la E.
 */
export function amountStep<S>(def: AmountStepDef<S>): WizardStep<S> {
  return {
    dependsOn: def.dependsOn,
    name: def.name ?? 'monto',
    run: async (state, previous) => {
      const answer = await askTextStep(def.message(state), {
        previousAnswer: amountInputText(previous ? def.amount.get(previous as S) : undefined),
        validate: def.validate?.(state) ?? validateAmount,
      });

      if (answer === BACK) {
        return BACK;
      }

      const amount = parseAmountInput(answer);

      return def.write ? def.write(amount, state) : def.amount.set(amount, state);
    },
    skip: def.skip,
    writes: def.writes,
  };
}

/** El validador del total de A, B y C: el formato (`base`, por defecto el del monto) y las reglas que leen el total. */
export function billingAmountValidator(
  rules: BillingRuleScope,
  base: (value: string) => string | true = validateAmount,
): (value: string) => string | true {
  return scopedRuleValidator(
    BILLING_RULES,
    'totalAmount',
    rules,
    (value) => ({ totalAmount: parseAmountInput(value) }),
    base,
  );
}
