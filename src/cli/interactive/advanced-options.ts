import { formatArgentineAmount, formatExchangeRate } from '../../lib/numbers/argentine-amount';
import { DEFAULT_CURRENCY_CODE, DEFAULT_EXCHANGE_RATE } from '../../modules/billing/billing.constants';
import { isForeignCurrency } from '../../modules/billing/billing.currency';
import type { BillingCommandInput } from '../../modules/billing/billing.schemas';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import { findArcaCurrency, toIsoCurrencyCode } from '../../modules/billing/currency-codes';
import { parseAmountInput, parseExchangeRateInput } from '../../modules/interactive/amount-input';
import { ivaRateChoices } from '../../modules/interactive/choices';
import { BACK, type Back } from '../../modules/interactive/wizard';

import { askTextStep, chooseManyStep, chooseStep } from './prompts';
import { validateDate, validateExchangeRate, validateOptionalAmount } from './validators';

export type AdvancedOptions = Pick<
  BillingCommandInput,
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

export type AdvancedOptionKey = 'alicuota' | 'divisas' | 'exento' | 'servicio' | 'transferencia' | 'vencimiento';
type Option = AdvancedOptionKey;

interface AdvancedContext {
  readonly concept: BillingCommandInput['concept'];
  /** Alicuota que se usa si no se elige otra: la de la config o 21%. */
  readonly defaultIvaRate: NonNullable<BillingCommandInput['ivaRate']>;
  /** La moneda no se puede cambiar: al repetir un comprobante en moneda extranjera, el monto ya esta en esa moneda. */
  readonly fixedCurrency?: boolean;
  /** Opciones que arrancan marcadas, por ejemplo la alicuota al repetir una factura de la que no se deduce. */
  readonly preselected?: readonly Option[];
  readonly voucherKind: VoucherKindDefinition;
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

  return options.sameCurrency
    ? `${name}, cotización oficial de ARCA`
    : `${name}, cotización ${formatExchangeRate(options.exchangeRate ?? DEFAULT_EXCHANGE_RATE)}`;
}

function describeAmounts(options: AdvancedOptions): string {
  const parts = [
    options.exemptAmount ? `exento ${formatArgentineAmount(options.exemptAmount)}` : undefined,
    options.untaxedAmount ? `no gravado ${formatArgentineAmount(options.untaxedAmount)}` : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(', ') : 'sin exento ni no gravado';
}

/**
 * La cotizacion de un comprobante en moneda extranjera, como la pregunta "Emitir factura": si te pagan en pesos se
 * ingresa la acordada y, si te pagan en esa moneda, se usa la oficial de ARCA (`--misma-moneda`).
 */
export async function askExchangeRate(current: AdvancedOptions, currencyCode: string): Promise<AdvancedOptions | Back> {
  const iso = toIsoCurrencyCode(currencyCode);
  const payment = await chooseStep('¿Cómo te pagan?', [
    { description: 'Ingresás la cotización acordada', name: 'En pesos', value: 'pesos' as const },
    {
      description: 'Se usa la cotización oficial de ARCA',
      name: `En ${currencyName(iso)}`,
      value: 'moneda' as const,
    },
  ]);

  if (payment === BACK) {
    return BACK;
  }

  if (payment === 'moneda') {
    return { ...current, currencyCode: iso, exchangeRate: undefined, sameCurrency: true };
  }

  const rate = await askTextStep(`Cotización de ${iso}:`, { validate: validateExchangeRate });

  return rate === BACK
    ? BACK
    : { ...current, currencyCode: iso, exchangeRate: parseExchangeRateInput(rate), sameCurrency: false };
}

async function askCurrency(current: AdvancedOptions): Promise<AdvancedOptions | Back> {
  const currency = await chooseStep('Moneda del comprobante:', [
    { name: 'Pesos', value: 'PES' as const },
    { name: 'Dólares (USD)', value: 'USD' as const },
  ]);

  if (currency === BACK) {
    return BACK;
  }

  if (currency === 'PES') {
    return { ...current, currencyCode: DEFAULT_CURRENCY_CODE, exchangeRate: undefined, sameCurrency: false };
  }

  return askExchangeRate(current, currency);
}

async function askExemptAmounts(current: AdvancedOptions): Promise<AdvancedOptions | Back> {
  const exempt = await askTextStep('Parte exenta del monto total (vacío si no hay):', {
    validate: validateOptionalAmount,
  });

  if (exempt === BACK) {
    return BACK;
  }

  const untaxed = await askTextStep('Parte no gravada del monto total (vacío si no hay):', {
    validate: validateOptionalAmount,
  });

  if (untaxed === BACK) {
    return BACK;
  }

  return { ...current, exemptAmount: parseAmountInput(exempt), untaxedAmount: parseAmountInput(untaxed) };
}

async function askServicePeriod(current: AdvancedOptions): Promise<AdvancedOptions | Back> {
  const start = await askTextStep('Servicio desde:', { validate: validateDate });

  if (start === BACK) {
    return BACK;
  }

  const end = await askTextStep('Servicio hasta:', { validate: validateDate });

  return end === BACK ? BACK : { ...current, serviceEndDate: end, serviceStartDate: start };
}

async function askPaymentDueDate(current: AdvancedOptions): Promise<AdvancedOptions | Back> {
  const due = await askTextStep('Vencimiento del pago:', { validate: validateDate });

  return due === BACK ? BACK : { ...current, paymentDueDate: due };
}

async function askIvaRate(current: AdvancedOptions, context: AdvancedContext): Promise<AdvancedOptions | Back> {
  const ivaRate = await chooseStep('Alícuota de IVA:', ivaRateChoices(), current.ivaRate ?? context.defaultIvaRate);

  return ivaRate === BACK ? BACK : { ...current, ivaRate };
}

async function askTransferMode(current: AdvancedOptions): Promise<AdvancedOptions | Back> {
  const transferMode = await chooseStep(
    'Modalidad de transferencia:',
    [
      { description: 'La opción habitual', name: 'Sistema de circulación abierta (SCA)', value: 'sca' as const },
      { name: 'Agente de depósito colectivo (ADC)', value: 'adc' as const },
    ],
    current.transferMode ?? 'sca',
  );

  return transferMode === BACK ? BACK : { ...current, transferMode };
}

function optionalChoices(options: AdvancedOptions, context: AdvancedContext) {
  const usesService = context.concept !== 'productos';
  const isFceInvoice = context.voucherKind.family === 'factura-credito-electronica';
  const discriminatesIva = context.voucherKind.letter !== 'c';

  return [
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
    ...(usesService || isFceInvoice
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
  ];
}

/**
 * Despues de lo requerido, una sola pregunta con todos los opcionales: se marcan con espacio y Enter sigue
 * (sin marcar nada, todo queda por defecto). Despues se pregunta solo lo marcado, en orden. "Volver" en una
 * de esas preguntas vuelve a la seleccion, con lo marcado y lo ya respondido.
 */
export async function askAdvancedOptions(
  initial: AdvancedOptions,
  context: AdvancedContext,
): Promise<AdvancedOptions | Back> {
  const asks: Record<Option, (current: AdvancedOptions) => Promise<AdvancedOptions | Back>> = {
    alicuota: (current) => askIvaRate(current, context),
    divisas: askCurrency,
    exento: askExemptAmounts,
    servicio: askServicePeriod,
    transferencia: askTransferMode,
    vencimiento: askPaymentDueDate,
  };
  let options = initial;
  let selected: Option[] = [...(context.preselected ?? [])];

  for (;;) {
    const picked = await chooseManyStep<Option>(
      '¿Agregamos algún opcional? (espacio para marcar, Enter para seguir)',
      optionalChoices(options, context),
      selected,
    );

    if (picked === BACK) {
      return BACK;
    }

    selected = picked;

    let completed = true;

    for (const option of picked) {
      const updated = await asks[option](options);

      if (updated === BACK) {
        completed = false;
        break;
      }

      options = updated;
    }

    if (completed) {
      return options;
    }
  }
}
