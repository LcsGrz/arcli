import { DEFAULT_CURRENCY_CODE } from '../../modules/billing/billing.constants';
import { isForeignCurrency } from '../../modules/billing/billing.currency';
import { toIsoCurrencyCode } from '../../modules/billing/currency-codes';
import { amountInputText, parseAmountInput, parseExchangeRateInput } from '../../modules/interactive/amount-input';
import {
  type AdvancedOptions,
  type BillingOptionalQuestions,
  billingOptionals,
  type BillingOptionalsContext,
  currencyName,
} from '../../modules/interactive/billing-optionals';
import { currencyChoices, ivaRateChoices } from '../../modules/interactive/choices';
import { BACK, type Back, type WizardStep } from '../../modules/interactive/wizard';

import { askConsumerDocumentNumber, askConsumerDocumentType } from './consumer-identification';
import { markIfNew } from './new-mark';
import { optionalsStep } from './optionals-step';
import { askTextStep, chooseStep } from './prompts';
import { validateBillingDate, validateDate, validateExchangeRate, validateOptionalAmount } from './validators';

/** El codigo de la moneda en la lista de monedas: `PES` para pesos. */
function currencyChoiceValue(options: { readonly currencyCode?: string }): string {
  return options.currencyCode && isForeignCurrency({ currencyCode: options.currencyCode })
    ? toIsoCurrencyCode(options.currencyCode)
    : 'PES';
}

/**
 * Como se cobra un comprobante en moneda extranjera, como pregunta "Emitir factura": en pesos (se ingresa la cotizacion
 * acordada) o en esa moneda (se usa la oficial de ARCA, `--misma-moneda`). Devuelve si es en esa moneda.
 */
export async function askPaymentCurrency(currencyCode: string, previous?: boolean): Promise<Back | boolean> {
  const payment = await chooseStep(
    '¿Cómo te pagan?',
    [
      { description: 'Ingresás la cotización acordada', name: 'En pesos', value: 'pesos' as const },
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

/** La cotizacion acordada, si te pagan en pesos un comprobante en moneda extranjera. */
export async function askAgreedExchangeRate(
  currencyCode: string,
  previous?: number,
): Promise<Back | number | undefined> {
  const rate = await askTextStep(`Cotización de ${toIsoCurrencyCode(currencyCode)}:`, {
    previousAnswer: amountInputText(previous),
    validate: validateExchangeRate,
  });

  return rate === BACK ? BACK : parseExchangeRateInput(rate);
}

/** Una fecha del periodo del servicio ("Servicio desde:" o "Servicio hasta:"). Lo comparten los opcionales y "Repetir". */
export async function askServiceDate(end: 'desde' | 'hasta', previous?: string): Promise<Back | string> {
  return askTextStep(`Servicio ${end}:`, { previousAnswer: previous, validate: validateDate });
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
  consumidor: () => [
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
      run: async (current, previous) => {
        const documentNumber = await askConsumerDocumentNumber(
          current.consumerDocumentType ?? 'dni',
          previous?.consumerDocumentNumber,
        );

        return documentNumber === BACK ? BACK : { consumerDocumentNumber: documentNumber };
      },
    },
  ],
  divisas: () => [
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

        return sameCurrency === BACK ? BACK : { exchangeRate: undefined, sameCurrency };
      },
      skip: (current) => !isForeignCurrency(current),
    },
    {
      dependsOn: ['moneda', 'pago'],
      name: 'cotizacion',
      run: async (current, previous) => {
        const exchangeRate = await askAgreedExchangeRate(current.currencyCode ?? '', previous?.exchangeRate);

        return exchangeRate === BACK ? BACK : { exchangeRate };
      },
      skip: (current) => !isForeignCurrency(current) || Boolean(current.sameCurrency),
    },
  ],
  exento: () => [
    {
      name: 'exento',
      run: async (_current, previous) => {
        const exempt = await askTextStep('Parte exenta del monto total (vacío si no hay):', {
          previousAnswer: amountInputText(previous?.exemptAmount),
          validate: validateOptionalAmount,
        });

        return exempt === BACK ? BACK : { exemptAmount: parseAmountInput(exempt) };
      },
    },
    {
      name: 'no-gravado',
      run: async (_current, previous) => {
        const untaxed = await askTextStep('Parte no gravada del monto total (vacío si no hay):', {
          previousAnswer: amountInputText(previous?.untaxedAmount),
          validate: validateOptionalAmount,
        });

        return untaxed === BACK ? BACK : { untaxedAmount: parseAmountInput(untaxed) };
      },
    },
  ],
  fecha: (context) => [
    {
      name: 'fecha',
      run: async (_current, previous) => {
        const date = await askTextStep('Fecha del comprobante:', {
          previousAnswer: previous?.billingDate,
          validate: (value) => validateBillingDate(value, context.concept, context.voucherKind),
        });

        return date === BACK ? BACK : { billingDate: date };
      },
    },
  ],
  servicio: () => [
    {
      name: 'servicio-desde',
      run: async (_current, previous) => {
        const start = await askServiceDate('desde', previous?.serviceStartDate);

        return start === BACK ? BACK : { serviceStartDate: start };
      },
    },
    {
      name: 'servicio-hasta',
      run: async (_current, previous) => {
        const end = await askServiceDate('hasta', previous?.serviceEndDate);

        return end === BACK ? BACK : { serviceEndDate: end };
      },
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
  vencimiento: () => [
    {
      name: 'vencimiento',
      run: async (_current, previous) => {
        const due = await askTextStep('Vencimiento del pago:', {
          previousAnswer: previous?.paymentDueDate,
          validate: validateDate,
        });

        return due === BACK ? BACK : { paymentDueDate: due };
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
