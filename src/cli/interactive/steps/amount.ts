import { BILLING_RULES } from '../../../modules/billing/billing.rules';
import { amountInputText, parseAmountInput } from '../../../modules/interactive/amount-input';
import type { BillingRuleScope } from '../../../modules/interactive/billing-optionals';
import { scopedRuleValidator } from '../../../modules/interactive/rule-validator';
import { AMOUNT_CURRENCY_FIELD, amountCurrencyCode, amountQuestion } from '../../../modules/interactive/steps/amount';
import type { Lens } from '../../../modules/interactive/steps/lens';
import { validateAmount } from '../../../modules/interactive/validators';
import { BACK, type WizardDependency, type WizardFinalize, type WizardStep } from '../../../modules/interactive/wizard';
import { askTextStep } from '../prompts';

/**
 * La moneda nueva cuando `finalize` vuelve al monto porque los opcionales cambiaron la moneda en que se escribio
 * (REV-74, #12): el estado de la pregunta es el de antes de los opcionales, asi que la recuerda el `finalize` del
 * flujo (`finalize`) y la pregunta la nombra (`currency`).
 */
export interface AmountCurrencyRetry<S> {
  readonly finalize: (inner: WizardFinalize<S>) => WizardFinalize<S>;
  /** La moneda que nombra la pregunta si se volvio por el error de `finalize` (`error`); si no, `undefined`. */
  readonly currency: (error: string | undefined) => string | undefined;
}

/** `finalCurrency` es la moneda con que sale el comprobante, con todas las respuestas. */
export function amountCurrencyRetry<S>(finalCurrency: (state: S) => string | undefined): AmountCurrencyRetry<S> {
  let pending: string | undefined;

  return {
    currency: (error) => (error ? pending : undefined),
    finalize: (inner) => (state) => {
      const failed = inner(state);
      const fields = failed ? [failed.field].flat() : [];

      pending = fields.includes(AMOUNT_CURRENCY_FIELD) ? finalCurrency(state) : undefined;

      return failed;
    },
  };
}

export interface AmountStepDef<S> {
  /** Por defecto, `monto`. */
  readonly name?: string;
  readonly amount: Lens<S, number>;
  /** El comienzo de la pregunta ("Monto total", "Monto de la nota de crédito"): sigue la moneda si no es pesos. */
  readonly label: string | ((state: S) => string);
  /** La moneda del monto, como se sabe al preguntarlo. */
  readonly currency: (state: S) => string | undefined;
  /**
   * Si la moneda se puede cambiar despues (en los opcionales): el paso guarda en `amountCurrency` la moneda en que se
   * pregunto, para que `finalize` controle que no cambie, y al volver por ese error la pregunta nombra la nueva.
   */
  readonly retry?: AmountCurrencyRetry<S>;
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
 * El monto, escrito como en los flags (`1.500,50`) y validado igual, con la moneda en la pregunta si no es pesos
 * (REV-74, #12). Al volver arranca escrito. Lo comparten "Emitir factura" y "Emitir recibo", las notas, "Repetir" y la
 * E.
 */
export function amountStep<S>(def: AmountStepDef<S>): WizardStep<S> {
  return {
    dependsOn: def.dependsOn,
    name: def.name ?? 'monto',
    run: async (state, { error, previous }) => {
      const currency = def.retry?.currency(error) ?? def.currency(state);
      const label = typeof def.label === 'string' ? def.label : def.label(state);
      const answer = await askTextStep(amountQuestion(label, currency), {
        previousAnswer: amountInputText(previous ? def.amount.get(previous as S) : undefined),
        validate: def.validate?.(state) ?? validateAmount,
      });

      if (answer === BACK) {
        return BACK;
      }

      const amount = parseAmountInput(answer);
      const written = def.write ? def.write(amount, state) : def.amount.set(amount, state);

      return def.retry ? ({ ...written, amountCurrency: amountCurrencyCode(currency) } as Partial<S>) : written;
    },
    skip: def.skip,
    writes: def.retry ? [...(def.writes ?? []), AMOUNT_CURRENCY_FIELD] : def.writes,
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
