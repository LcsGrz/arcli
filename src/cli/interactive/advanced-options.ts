import { formatExchangeRate } from '../../lib/numbers/argentine-amount';
import { DEFAULT_CURRENCY_CODE } from '../../modules/billing/billing.constants';
import { isForeignCurrency } from '../../modules/billing/billing.currency';
import { BILLING_RULES } from '../../modules/billing/billing.rules';
import type { BillingCommandInput } from '../../modules/billing/billing.schemas';
import { toIsoCurrencyCode } from '../../modules/billing/currency-codes';
import { amountInputText, parseAmountInput, parseExchangeRateInput } from '../../modules/interactive/amount-input';
import {
  advancedInputFields,
  type AdvancedOptions,
  type BillingOptionalQuestions,
  billingOptionals,
  type BillingOptionalsContext,
  type BillingRuleScope,
  currencyName,
  type ExchangeRateSuggestion,
} from '../../modules/interactive/billing-optionals';
import { currencyChoices, ivaRateChoices } from '../../modules/interactive/choices';
import { completeDateInput } from '../../modules/interactive/date-input';
import { scopedRuleValidator } from '../../modules/interactive/rule-validator';
import { BACK, type Back, type WizardStep } from '../../modules/interactive/wizard';

import { askConsumerDocumentNumber, askConsumerDocumentType } from './consumer-identification';
import { markIfNew } from './new-mark';
import { optionalsStep } from './optionals-step';
import { askTextStep, chooseStep } from './prompts';
import {
  normalizeDocumentNumber,
  validateBillingDate,
  validateDate,
  validateExchangeRate,
  validateOptionalAmount,
} from './validators';

/** El codigo de la moneda en la lista de monedas: `PES` para pesos. */
function currencyChoiceValue(options: { readonly currencyCode?: string }): string {
  return options.currencyCode && isForeignCurrency({ currencyCode: options.currencyCode })
    ? toIsoCurrencyCode(options.currencyCode)
    : 'PES';
}

/**
 * Como se cobra un comprobante en moneda extranjera, como pregunta "Emitir factura": en pesos (la cotizacion arranca
 * con la oficial de ARCA y se puede cambiar por la acordada) o en esa moneda (se usa la oficial de ARCA,
 * `--misma-moneda`). Devuelve si es en esa moneda.
 */
export async function askPaymentCurrency(currencyCode: string, previous?: boolean): Promise<Back | boolean> {
  const payment = await chooseStep(
    '¿Cómo te pagan?',
    [
      {
        description: `El comprobante va en ${currencyName(currencyCode)} y lo cobrás en pesos: cotización oficial de ARCA o la acordada`,
        name: 'En pesos',
        value: 'pesos' as const,
      },
      {
        description: 'Se usa la cotización oficial de ARCA',
        name: `En ${currencyName(currencyCode)}`,
        value: 'moneda' as const,
      },
    ],
    previous === undefined ? undefined : previous ? 'moneda' : 'pesos',
  );

  return payment === BACK ? BACK : payment === 'moneda';
}

/** La cotizacion de un comprobante en moneda extranjera cobrado en pesos, y de donde sale si no se escribio. */
export type AgreedExchangeRate = Pick<AdvancedOptions, 'exchangeRate' | 'exchangeRateSource'>;

/**
 * La cotizacion, si te pagan en pesos un comprobante en moneda extranjera. Arranca escrita con la escrita antes o, si no
 * hay, con `suggested`: la de la config (`cotizacion`, deprecada) si el CLI la tomaria sin `--cm`, o la oficial de
 * ARCA. Si dejas lo que arranco escrito, va como el CLI sin `--cm`: la de la config marcada como tal, o ninguna (la
 * vista previa consulta la oficial). Si escribis otra cosa, es la acordada y va con `--cm`. Sin `suggested` (la consulta
 * de la oficial fallo), arranca vacia.
 */
export async function askAgreedExchangeRate(
  currencyCode: string,
  previous?: AgreedExchangeRate,
  suggested?: ExchangeRateSuggestion,
): Promise<AgreedExchangeRate | Back> {
  const iso = toIsoCurrencyCode(currencyCode);
  // Solo una escrita a mano arranca como antes; una sugerida se vuelve a sugerir (la oficial puede haber cambiado).
  const typed = previous?.exchangeRateSource === undefined ? previous?.exchangeRate : undefined;
  const suggestedText = typed === undefined ? amountInputText(suggested?.rate) : undefined;
  const rate = await askTextStep(`Cotización de ${iso}${suggested ? ` (${describeSuggestion(suggested)})` : ''}:`, {
    previousAnswer: suggestedText ?? amountInputText(typed),
    validate: validateExchangeRate,
  });

  if (rate === BACK) {
    return BACK;
  }

  if (suggested && suggestedText !== undefined && rate.trim() === suggestedText) {
    return suggested.source === 'config'
      ? { exchangeRate: suggested.rate, exchangeRateSource: 'config' }
      : { exchangeRate: undefined, exchangeRateSource: undefined };
  }

  return { exchangeRate: parseExchangeRateInput(rate), exchangeRateSource: undefined };
}

function describeSuggestion(suggested: ExchangeRateSuggestion): string {
  const rate = formatExchangeRate(suggested.rate);

  return suggested.source === 'config'
    ? `la de tu config, \`cotizacion\`, es ${rate}`
    : `la oficial de ARCA es ${rate}`;
}

/**
 * Una fecha del periodo del servicio ("Servicio desde:" o "Servicio hasta:"), con la regla del orden (10032) sobre
 * `answered`, lo respondido hasta ahi. Lo comparten los opcionales y "Repetir".
 */
export async function askServiceDate(
  end: 'desde' | 'hasta',
  previous: string | undefined,
  rules: BillingRuleScope,
  answered: Partial<BillingCommandInput>,
): Promise<Back | string> {
  const field = end === 'desde' ? 'serviceStartDate' : 'serviceEndDate';
  const date = await askTextStep(`Servicio ${end}:`, {
    previousAnswer: previous,
    validate: scopedRuleValidator(
      BILLING_RULES,
      field,
      rules,
      (value) => ({ ...answered, [field]: completeDateInput(value) }),
      validateDate,
    ),
  });

  return date === BACK ? BACK : completeDateInput(date);
}

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
  consumidor: (context) => [
    {
      name: 'consumidor-documento',
      run: async (current, previous) => {
        const documentType = await askConsumerDocumentType(
          previous?.consumerDocumentType ?? current.consumerDocumentType,
        );

        return documentType === BACK ? BACK : { consumerDocumentNumber: undefined, consumerDocumentType: documentType };
      },
    },
    {
      // La pregunta y la validacion cambian con el tipo.
      dependsOn: ['consumidor-documento'],
      name: 'consumidor-numero',
      // El documento del consumidor va como el del receptor (`documentNumber`): no puede ser el CUIT emisor (10069).
      writes: ['documentNumber'],
      run: async (current, previous) => {
        const documentType = current.consumerDocumentType ?? 'dni';
        const documentNumber = await askConsumerDocumentNumber(documentType, previous?.consumerDocumentNumber, (base) =>
          scopedRuleValidator(
            BILLING_RULES,
            'documentNumber',
            context.rules,
            (value) => ({
              ...advancedInputFields(current),
              documentNumber: normalizeDocumentNumber(value),
              documentType,
            }),
            base,
          ),
        );

        return documentNumber === BACK ? BACK : { consumerDocumentNumber: documentNumber };
      },
    },
  ],
  divisas: (context) => [
    {
      name: 'moneda',
      run: async (current, previous) => {
        const currency = await chooseStep(
          'Moneda del comprobante:',
          currencyChoices(),
          currencyChoiceValue(previous ?? current),
        );

        if (currency === BACK) {
          return BACK;
        }

        return {
          currencyCode: currency === 'PES' ? DEFAULT_CURRENCY_CODE : currency,
          exchangeRate: undefined,
          exchangeRateSource: undefined,
          sameCurrency: false,
        };
      },
    },
    {
      // La pregunta nombra la moneda.
      dependsOn: ['moneda'],
      name: 'pago',
      run: async (current, previous) => {
        const sameCurrency = await askPaymentCurrency(current.currencyCode ?? '', previous?.sameCurrency);

        return sameCurrency === BACK ? BACK : { exchangeRate: undefined, exchangeRateSource: undefined, sameCurrency };
      },
      skip: (current) => !isForeignCurrency(current),
    },
    {
      dependsOn: ['moneda', 'pago'],
      name: 'cotizacion',
      run: async (current, previous) => {
        const currencyCode = current.currencyCode ?? '';

        return askAgreedExchangeRate(currencyCode, previous, await context.exchangeRateSuggestion?.(currencyCode));
      },
      skip: (current) => !isForeignCurrency(current) || Boolean(current.sameCurrency),
    },
  ],
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
  fecha: (context) => [
    {
      name: 'fecha',
      writes: ['billingDate'],
      run: async (current, previous) => {
        const date = await askTextStep('Fecha del comprobante:', {
          previousAnswer: previous?.billingDate,
          // La ventana de ARCA (tambien sin las reglas del flujo) y que no quede antes del periodo o del asociado.
          validate: billingRule(
            context,
            'billingDate',
            current,
            (value) => ({ billingDate: completeDateInput(value) }),
            (value) => validateBillingDate(value, context.concept, context.voucherKind),
          ),
        });

        return date === BACK ? BACK : { billingDate: completeDateInput(date) };
      },
    },
  ],
  servicio: (context) => [
    {
      name: 'servicio-desde',
      run: async (current, previous) => {
        const start = await askServiceDate(
          'desde',
          previous?.serviceStartDate,
          context.rules,
          advancedInputFields(current),
        );

        return start === BACK ? BACK : { serviceStartDate: start };
      },
      writes: ['serviceStartDate'],
    },
    {
      name: 'servicio-hasta',
      run: async (current, previous) => {
        const end = await askServiceDate(
          'hasta',
          previous?.serviceEndDate,
          context.rules,
          advancedInputFields(current),
        );

        return end === BACK ? BACK : { serviceEndDate: end };
      },
      writes: ['serviceEndDate'],
    },
  ],
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
    {
      name: 'vencimiento',
      writes: ['paymentDueDate'],
      run: async (current, previous) => {
        const due = await askTextStep('Vencimiento del pago:', {
          previousAnswer: previous?.paymentDueDate,
          validate: billingRule(
            context,
            'paymentDueDate',
            current,
            (value) => ({ paymentDueDate: completeDateInput(value) }),
            validateDate,
          ),
        });

        return due === BACK ? BACK : { paymentDueDate: completeDateInput(due) };
      },
    },
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

/** Los opcionales de A, B y C (`optionalsStep` con su catalogo): factura, recibo, notas y "Repetir". */
export function billingOptionalsStep<S>(def: BillingOptionalsStepDef<S>): WizardStep<S> {
  return optionalsStep({
    ...def,
    decorate: (choice) => (choice.value === 'consumidor' ? markIfNew(choice, 'datos-consumidor-final') : choice),
    options: BILLING_OPTIONALS,
    preselected: (context) => context.preselected ?? [],
  });
}
