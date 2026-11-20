import { BILLING_RULES } from '../../modules/billing/billing.rules';
import type { BillingCommandInput } from '../../modules/billing/billing.schemas';
import { amountInputText, parseAmountInput } from '../../modules/interactive/amount-input';
import {
  advancedInputFields,
  type AdvancedOptions,
  type BillingOptionalQuestions,
  billingOptionals,
  type BillingOptionalsContext,
} from '../../modules/interactive/billing-optionals';
import { ivaRateChoices } from '../../modules/interactive/choices';
import { completeDateInput } from '../../modules/interactive/date-input';
import { optionalGroup } from '../../modules/interactive/optional-group';
import { scopedRuleValidator } from '../../modules/interactive/rule-validator';
import type { Lens } from '../../modules/interactive/steps/lens';
import { BACK, type WizardStep } from '../../modules/interactive/wizard';

import { markIfNew } from './new-mark';
import { optionalsGroupDef } from './optionals-step';
import { askTextStep, chooseStep } from './prompts';
import { type BillingOptionalsGroup, consumerQuestions } from './steps/consumer';
import { currencySteps } from './steps/currency';
import { dateStep, servicePeriodSteps } from './steps/date';
import { validateBillingDate, validateDate, validateOptionalAmount } from './validators';

/** El validador de una pregunta de un opcional: el formato (`validate`) y las reglas que leen `field`. */
function billingRule(
  context: BillingOptionalsContext,
  field: string,
  current: AdvancedOptions,
  patch: (value: string) => Partial<BillingCommandInput>,
  validate: (value: string) => string | true,
): (value: string) => string | true {
  return scopedRuleValidator(
    BILLING_RULES,
    field,
    context.rules,
    (value) => ({ ...advancedInputFields(current), ...patch(value) }),
    validate,
  );
}

/** Un campo de los opcionales: cada pregunta escribe solo lo suyo. */
function own<K extends keyof AdvancedOptions & string>(key: K): Lens<AdvancedOptions, NonNullable<AdvancedOptions[K]>> {
  return {
    get: (current) => current[key] ?? undefined,
    set: (value) => ({ [key]: value }) as Partial<AdvancedOptions>,
  };
}

/** Una fecha de los opcionales, con las reglas que la leen. */
function optionalDate(
  context: BillingOptionalsContext,
  name: string,
  message: string,
  field: 'billingDate' | 'paymentDueDate',
  validate: (value: string) => string | true,
): WizardStep<AdvancedOptions> {
  return dateStep<AdvancedOptions>({
    date: own(field),
    message,
    name,
    validate: (current) =>
      billingRule(context, field, current, (value) => ({ [field]: completeDateInput(value) }), validate),
    writes: [field],
  });
}

/** Las preguntas de cada opcional, una por paso: "Volver" lleva a la anterior, y desde la primera, a la seleccion. */
const QUESTIONS: BillingOptionalQuestions = {
  alicuota: (context) => [
    {
      name: 'alicuota',
      run: async (current, previous) => {
        const ivaRate = await chooseStep(
          'Alícuota de IVA:',
          ivaRateChoices(),
          previous?.ivaRate ?? current.ivaRate ?? context.defaultIvaRate,
        );

        return ivaRate === BACK ? BACK : { ivaRate };
      },
    },
  ],
  consumidor: consumerQuestions,
  divisas: (context) =>
    currencySteps<AdvancedOptions>({
      currency: { get: (current) => current, set: (value) => value ?? {} },
      suggestion: context.exchangeRateSuggestion,
    }),
  exento: (context) => [
    {
      name: 'exento',
      writes: ['exemptAmount'],
      run: async (current, previous) => {
        const exempt = await askTextStep('Parte exenta del monto total (vacío si no hay):', {
          previousAnswer: amountInputText(previous?.exemptAmount),
          validate: billingRule(
            context,
            'exemptAmount',
            current,
            (value) => ({ exemptAmount: parseAmountInput(value) }),
            validateOptionalAmount,
          ),
        });

        return exempt === BACK ? BACK : { exemptAmount: parseAmountInput(exempt) };
      },
    },
    {
      name: 'no-gravado',
      writes: ['untaxedAmount'],
      run: async (current, previous) => {
        const untaxed = await askTextStep('Parte no gravada del monto total (vacío si no hay):', {
          previousAnswer: amountInputText(previous?.untaxedAmount),
          validate: billingRule(
            context,
            'untaxedAmount',
            current,
            (value) => ({ untaxedAmount: parseAmountInput(value) }),
            validateOptionalAmount,
          ),
        });

        return untaxed === BACK ? BACK : { untaxedAmount: parseAmountInput(untaxed) };
      },
    },
  ],
  // La ventana de ARCA (tambien sin las reglas del flujo) y que no quede antes del periodo o del asociado.
  fecha: (context) => [
    optionalDate(context, 'fecha', 'Fecha del comprobante:', 'billingDate', (value) =>
      validateBillingDate(value, context.concept, context.voucherKind),
    ),
  ],
  servicio: (context) =>
    servicePeriodSteps<AdvancedOptions>({
      answered: advancedInputFields,
      from: own('serviceStartDate'),
      prefix: 'servicio',
      rules: () => context.rules,
      to: own('serviceEndDate'),
    }),
  transferencia: () => [
    {
      name: 'transferencia',
      run: async (current, previous) => {
        const transferMode = await chooseStep(
          'Modalidad de transferencia:',
          [
            {
              description: 'La opción habitual',
              name: 'Sistema de circulación abierta (SCA)',
              value: 'sca' as const,
            },
            { name: 'Agente de depósito colectivo (ADC)', value: 'adc' as const },
          ],
          previous?.transferMode ?? current.transferMode ?? 'sca',
        );

        return transferMode === BACK ? BACK : { transferMode };
      },
    },
  ],
  vencimiento: (context) => [
    optionalDate(context, 'vencimiento', 'Vencimiento del pago:', 'paymentDueDate', validateDate),
  ],
};

const BILLING_OPTIONALS = billingOptionals(QUESTIONS);

export interface BillingOptionalsStepDef<S> {
  /** Nombre del paso en el asistente del flujo. */
  readonly name: string;
  /** Los opcionales antes del paso: de ahi arranca cada respuesta y a eso vuelve lo desmarcado. */
  readonly read: (state: S) => AdvancedOptions;
  readonly write: (advanced: AdvancedOptions) => Partial<S>;
  readonly context: (state: S) => BillingOptionalsContext;
}

/**
 * El grupo de opcionales de A, B y C con su catalogo: el paso (`billingOptionalsStep`) y, desde el tope de la RG
 * 5700/2025, los datos del consumidor final como obligatorios (`consumerIdentificationSteps`) salen del mismo.
 */
export function billingOptionalsGroup<S>(def: BillingOptionalsStepDef<S>): BillingOptionalsGroup<S> {
  return optionalsGroupDef({
    ...def,
    decorate: (choice) => (choice.value === 'consumidor' ? markIfNew(choice, 'datos-consumidor-final') : choice),
    options: BILLING_OPTIONALS,
    preselected: (context) => context.preselected ?? [],
  });
}

/** Los opcionales de A, B y C (`optionalsStep` con su catalogo): factura, recibo, notas y "Repetir". */
export function billingOptionalsStep<S>(def: BillingOptionalsStepDef<S> | BillingOptionalsGroup<S>): WizardStep<S> {
  return optionalGroup('pick' in def ? def : billingOptionalsGroup(def));
}
