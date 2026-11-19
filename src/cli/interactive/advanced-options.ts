import { formatArgentineAmount, formatExchangeRate } from '../../lib/numbers/argentine-amount';
import { DEFAULT_CURRENCY_CODE, DEFAULT_EXCHANGE_RATE } from '../../modules/billing/billing.constants';
import { isForeignCurrency } from '../../modules/billing/billing.currency';
import type { BillingCommandInput } from '../../modules/billing/billing.schemas';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import { findArcaCurrency, toIsoCurrencyCode } from '../../modules/billing/currency-codes';
import type { ArcliConfig } from '../../modules/config/config.schemas';
import { amountInputText, parseAmountInput, parseExchangeRateInput } from '../../modules/interactive/amount-input';
import { currencyChoices, ivaRateChoices } from '../../modules/interactive/choices';
import { BACK, type Back, runWizard, type WizardAnswers, type WizardStep } from '../../modules/interactive/wizard';

import { askTextStep, chooseManyStep, chooseStep } from './prompts';
import { validateBillingDate, validateDate, validateExchangeRate, validateOptionalAmount } from './validators';

export type AdvancedOptions = Pick<
  BillingCommandInput,
  | 'billingDate'
  | 'currencyCode'
  | 'exchangeRate'
  | 'exemptAmount'
  | 'ivaRate'
  | 'paymentDueDate'
  | 'sameCurrency'
  | 'serviceEndDate'
  | 'serviceStartDate'
  | 'transferMode'
  | 'untaxedAmount'
>;

export type AdvancedOptionKey =
  'alicuota' | 'divisas' | 'exento' | 'fecha' | 'servicio' | 'transferencia' | 'vencimiento';
type Option = AdvancedOptionKey;

interface AdvancedContext {
  readonly concept: BillingCommandInput['concept'];
  /** Alicuota que se usa si no se elige otra: la de la config o 21%. */
  readonly defaultIvaRate: NonNullable<BillingCommandInput['ivaRate']>;
  /** La moneda no se puede cambiar: al repetir un comprobante en moneda extranjera, el monto ya esta en esa moneda. */
  readonly fixedCurrency?: boolean;
  /** Opciones que no se ofrecen: en las notas, la alicuota (tiene su paso) o la moneda (la de la factura). */
  readonly hidden?: readonly Option[];
  /** Opciones que arrancan marcadas, por ejemplo la alicuota al repetir una factura de la que no se deduce. */
  readonly preselected?: readonly Option[];
  readonly voucherKind: VoucherKindDefinition;
}

/**
 * Como el CLI sin `--moneda`: arranca en la moneda de la config y, si es extranjera, con su cotizacion guardada
 * (deprecada) o, sin ella, la oficial de ARCA.
 */
export function initialAdvancedOptions(
  config: Pick<ArcliConfig, 'cotizacionPorDefecto' | 'monedaPorDefecto'>,
): AdvancedOptions {
  const currencyCode = config.monedaPorDefecto;

  if (!currencyCode || !isForeignCurrency({ currencyCode })) {
    return { currencyCode: DEFAULT_CURRENCY_CODE, sameCurrency: false };
  }

  const rate = config.cotizacionPorDefecto;

  return {
    currencyCode: toIsoCurrencyCode(currencyCode),
    exchangeRate: rate !== undefined && rate !== DEFAULT_EXCHANGE_RATE ? rate : undefined,
    sameCurrency: false,
  };
}

/** Como se nombra la moneda en las preguntas: "dólares", "euros"; si no esta en la tabla, su codigo. */
function currencyName(currencyCode: string): string {
  const iso = toIsoCurrencyCode(currencyCode);

  if (iso === 'USD') {
    return 'dólares';
  }

  return findArcaCurrency(iso)?.name.toLowerCase() ?? iso;
}

function describeCurrency(options: AdvancedOptions): string {
  if (!options.currencyCode || !isForeignCurrency(options)) {
    return 'pesos';
  }

  const name = currencyName(options.currencyCode);

  // Sin cotizacion (la moneda de la config, sin `cotizacion`), el CLI usa la oficial de ARCA.
  return options.sameCurrency || options.exchangeRate === undefined
    ? `${name}, cotización oficial de ARCA`
    : `${name}, cotización ${formatExchangeRate(options.exchangeRate)}`;
}

function describeAmounts(options: AdvancedOptions): string {
  const parts = [
    options.exemptAmount ? `exento ${formatArgentineAmount(options.exemptAmount)}` : undefined,
    options.untaxedAmount ? `no gravado ${formatArgentineAmount(options.untaxedAmount)}` : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(', ') : 'sin exento ni no gravado';
}

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

type Step = WizardStep<AdvancedOptions>;

/** Las preguntas de cada opcional, una por paso: "Volver" lleva a la anterior, y desde la primera, a la seleccion. */
function optionSteps(context: AdvancedContext): Record<Option, Step[]> {
  return {
    alicuota: [
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
    divisas: [
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
    exento: [
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
    fecha: [
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
    servicio: [
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
    transferencia: [
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
    vencimiento: [
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
}

function optionalChoices(options: AdvancedOptions, context: AdvancedContext) {
  const usesService = context.concept !== 'productos';
  const isFceInvoice = context.voucherKind.family === 'factura-credito-electronica';
  const discriminatesIva = context.voucherKind.letter !== 'c';
  // Como el CLI: vencimiento en servicios y en la factura FCE; las notas FCE no lo llevan.
  const usesDueDate = isFceInvoice || (usesService && !context.voucherKind.isElectronicCredit);
  const hidden = new Set(context.hidden ?? []);

  return [
    { description: options.billingDate ?? 'hoy', name: 'Fecha del comprobante', value: 'fecha' as const },
    ...(discriminatesIva
      ? [
          {
            description: `${(options.ivaRate ?? context.defaultIvaRate).replace('.', ',')}%`,
            name: 'Alícuota de IVA',
            value: 'alicuota' as const,
          },
        ]
      : []),
    ...(context.fixedCurrency
      ? []
      : [{ description: describeCurrency(options), name: 'Moneda extranjera', value: 'divisas' as const }]),
    ...(discriminatesIva
      ? [{ description: describeAmounts(options), name: 'Importe exento o no gravado', value: 'exento' as const }]
      : []),
    ...(usesService
      ? [
          {
            description: options.serviceStartDate ? `${options.serviceStartDate} al ${options.serviceEndDate}` : 'hoy',
            name: 'Período del servicio',
            value: 'servicio' as const,
          },
        ]
      : []),
    ...(usesDueDate
      ? [
          {
            description: options.paymentDueDate ?? 'por defecto',
            name: 'Vencimiento del pago',
            value: 'vencimiento' as const,
          },
        ]
      : []),
    ...(isFceInvoice
      ? [
          {
            description: (options.transferMode ?? 'sca').toUpperCase(),
            name: 'Modalidad de transferencia',
            value: 'transferencia' as const,
          },
        ]
      : []),
  ].filter((choice) => !hidden.has(choice.value));
}

/** Lo que ya no aplica (por ejemplo, fechas de servicio si se cambio a productos) no llega al comprobante. */
function dropUnavailable(options: AdvancedOptions, available: ReadonlySet<Option>): AdvancedOptions {
  return {
    ...options,
    ...(available.has('exento') ? {} : { exemptAmount: undefined, untaxedAmount: undefined }),
    ...(available.has('servicio') ? {} : { serviceEndDate: undefined, serviceStartDate: undefined }),
    ...(available.has('vencimiento') ? {} : { paymentDueDate: undefined }),
  };
}

/**
 * `initial` con lo respondido en los opcionales `marked`, como si se confirmara cada pregunta con lo que ofrece: un
 * opcional cuenta solo si todas sus preguntas que aplican tienen respuesta. Los demas quedan como en `initial`.
 */
function withAnsweredOptions(
  initial: AdvancedOptions,
  marked: readonly Option[],
  steps: Record<Option, Step[]>,
  answers: WizardAnswers<AdvancedOptions>,
): AdvancedOptions {
  return marked.reduce((options, option) => {
    let answered = options;

    for (const step of steps[option]) {
      if (step.skip?.(answered)) {
        continue;
      }

      const answer = answers.get(step.name);

      if (!answer) {
        return options;
      }

      answered = { ...answered, ...answer };
    }

    return answered;
  }, initial);
}

/**
 * Despues de lo requerido, una sola pregunta con todos los opcionales: se marcan con espacio y Enter sigue
 * (sin marcar nada, todo queda por defecto). Despues se pregunta solo lo marcado, en orden, una pregunta por paso:
 * "Volver" lleva a la pregunta anterior y, desde la primera, a la seleccion con lo marcado. En la seleccion se ve lo
 * respondido de los opcionales con todas sus preguntas respondidas; uno a medias se ve como estaba. Con Enter, lo de
 * los opcionales desmarcados vuelve a como estaba y lo marcado se pregunta de nuevo, escrito o marcado con lo respondido.
 */
export async function askAdvancedOptions(
  initial: AdvancedOptions,
  context: AdvancedContext,
): Promise<AdvancedOptions | Back> {
  const steps = optionSteps(context);
  const answers: WizardAnswers<AdvancedOptions> = new Map();
  let selected: Option[] = [...(context.preselected ?? [])];
  let shown = initial;

  for (;;) {
    const picked = await chooseManyStep<Option>(
      '¿Agregamos algún opcional? (espacio para marcar, Enter para seguir)',
      optionalChoices(shown, context),
      selected,
    );

    if (picked === BACK) {
      return BACK;
    }

    selected = picked;

    // Desde `initial`: lo de un opcional desmarcado no llega, y lo marcado se vuelve a responder.
    const options = await runWizard(
      picked.flatMap((option) => steps[option]),
      initial,
      answers,
    );

    if (options) {
      return dropUnavailable(options, new Set(optionalChoices(options, context).map((choice) => choice.value)));
    }

    shown = withAnsweredOptions(initial, picked, steps, answers);
  }
}
