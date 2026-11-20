import { formatArgentineAmount, formatExchangeRate } from '../../lib/numbers/argentine-amount';
import { DEFAULT_CURRENCY_CODE } from '../billing/billing.constants';
import { isForeignCurrency, resolveConfigExchangeRate } from '../billing/billing.currency';
import type { BillingRuleContext } from '../billing/billing.rules';
import type { BillingCommandInput } from '../billing/billing.schemas';
import type { VoucherKindDefinition } from '../billing/billing.types';
import { findArcaCurrency, toIsoCurrencyCode } from '../billing/currency-codes';
import type { ArcliConfig } from '../config/config.schemas';

import {
  consumerIdentificationNotice,
  type ConsumerIdentity,
  describeConsumerIdentity,
} from './consumer-identification';
import type { OptionalDef } from './optional-group';
import type { RuleScope } from './rule-validator';
import type { ConsumerContext } from './steps/consumer';
import type { CurrencyLock } from './steps/currency';
import type { WizardStep } from './wizard';

/** Lo que cargan los opcionales de A, B y C (factura, recibo, FCE, notas y "Repetir"). */
export type AdvancedOptions = Pick<
  BillingCommandInput,
  | 'billingDate'
  | 'currencyCode'
  | 'exchangeRate'
  | 'exchangeRateSource'
  | 'exemptAmount'
  | 'ivaRate'
  | 'paymentDueDate'
  | 'sameCurrency'
  | 'serviceEndDate'
  | 'serviceStartDate'
  | 'transferMode'
  | 'untaxedAmount'
> &
  ConsumerIdentity;

export type AdvancedOptionKey =
  'alicuota' | 'consumidor' | 'divisas' | 'exento' | 'fecha' | 'servicio' | 'transferencia' | 'vencimiento';

/** Las reglas de A, B y C desde una pregunta: la entrada que se arma con lo respondido y su contexto. */
export type BillingRuleScope = RuleScope<BillingCommandInput, BillingRuleContext>;

export interface BillingOptionalsContext {
  readonly concept: BillingCommandInput['concept'];
  /**
   * Las reglas entre campos (`BILLING_RULES`) con la entrada del flujo: cada pregunta de un opcional las corre con lo
   * que escribe (REV-69, REV-70, REV-71).
   */
  readonly rules: BillingRuleScope;
  /**
   * El comprobante del que se copian la alicuota y el exento ("Repetir"), como una clave: si cambia, esos opcionales
   * olvidan lo marcado y respondido y arrancan con lo copiado del nuevo.
   */
  readonly copiedFrom?: string;
  /**
   * De donde sale el exento ("Repetir"), como una clave: con el mismo monto se copia de la factura; con otro se vuelve a
   * preguntar, con el opcional marcado (REV-70). Si cambia, el exento olvida lo marcado y respondido.
   */
  readonly exemptFrom?: string;
  /**
   * El receptor es consumidor final: su documento ("Datos del consumidor final") es opcional por debajo del tope de la
   * RG 5700/2025 (si el flujo lo ofrece) y obligatorio desde ahi (lo pide `requiredOptional`). Sin el, no aplica.
   */
  readonly consumer?: ConsumerContext;
  /** Alicuota que se usa si no se elige otra: la de la config o 21%. */
  readonly defaultIvaRate: NonNullable<BillingCommandInput['ivaRate']>;
  /** La moneda no se puede cambiar: en "Repetir", el monto ya esta en la moneda del original (REV-73). */
  readonly currencyLock?: CurrencyLock;
  /**
   * Con que cotizacion arranca escrita la pregunta si te pagan en pesos: la de la config si el CLI la tomaria, o la
   * oficial de ARCA. `undefined` si la consulta de la oficial falla: la pregunta arranca vacia.
   */
  readonly exchangeRateSuggestion?: (currencyCode: string) => Promise<ExchangeRateSuggestion | undefined>;
  /** Opciones que no se ofrecen: en las notas, la alicuota (tiene su paso) o la moneda (la de la factura). */
  readonly hidden?: readonly AdvancedOptionKey[];
  /** Opciones que arrancan marcadas, por ejemplo la alicuota al repetir una factura de la que no se deduce. */
  readonly preselected?: readonly AdvancedOptionKey[];
  readonly voucherKind: VoucherKindDefinition;
}

/** Las preguntas de cada opcional, una por paso: las inyecta `cli` (llaman a `prompts`). */
export type BillingOptionalQuestions = Readonly<
  Record<AdvancedOptionKey, (context: BillingOptionalsContext) => ReadonlyArray<WizardStep<AdvancedOptions>>>
>;

export type BillingOptionalDef = OptionalDef<AdvancedOptionKey, AdvancedOptions, BillingOptionalsContext>;

type CurrencyConfig = Pick<ArcliConfig, 'cotizacionPorDefecto' | 'monedaPorDefecto'>;

/**
 * La cotizacion de la config (`cotizacion`, deprecada) que tomaria el CLI sin `--cm` para `currencyCode`, cobrado en
 * pesos: la misma regla que el parser (`resolveConfigExchangeRate`).
 */
export function configExchangeRateFor(config: CurrencyConfig, currencyCode: string): number | undefined {
  return resolveConfigExchangeRate({
    configCurrencyCode: config.monedaPorDefecto,
    configExchangeRate: config.cotizacionPorDefecto,
    currencyCode,
    sameCurrency: false,
  });
}

/** Con que cotizacion arranca escrita la pregunta si te pagan en pesos, y de donde sale. */
export interface ExchangeRateSuggestion {
  readonly rate: number;
  readonly source: 'arca' | 'config';
}

/**
 * Como el CLI sin `--moneda`: arranca en la moneda de la config y, si es extranjera, con su cotizacion guardada
 * (deprecada, marcada como de la config para que la vista previa avise lo mismo que con flags) o, sin ella, la oficial
 * de ARCA.
 */
export function initialAdvancedOptions(config: CurrencyConfig): AdvancedOptions {
  const currencyCode = config.monedaPorDefecto;

  if (!currencyCode || !isForeignCurrency({ currencyCode })) {
    return { currencyCode: DEFAULT_CURRENCY_CODE, sameCurrency: false };
  }

  const rate = configExchangeRateFor(config, currencyCode);

  return {
    currencyCode: toIsoCurrencyCode(currencyCode),
    exchangeRate: rate,
    exchangeRateSource: rate === undefined ? undefined : 'config',
    sameCurrency: false,
  };
}

/** Como se nombra la moneda en las preguntas: "dólares", "euros"; si no esta en la tabla, su codigo. */
export function currencyName(currencyCode: string): string {
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

/** Sin fechas de servicio, el CLI usa la fecha del comprobante (#8): hoy, o la elegida en "Fecha del comprobante". */
function describeServicePeriod(options: AdvancedOptions): string {
  return options.serviceStartDate
    ? `${options.serviceStartDate} al ${options.serviceEndDate}`
    : (options.billingDate ?? 'hoy');
}

const copiedFrom = (context: BillingOptionalsContext): string => context.copiedFrom ?? '';
const discriminatesIva = (context: BillingOptionalsContext): boolean => context.voucherKind.letter !== 'c';
const usesService = (context: BillingOptionalsContext): boolean => context.concept !== 'productos';
const isFceInvoice = (context: BillingOptionalsContext): boolean =>
  context.voucherKind.family === 'factura-credito-electronica';

/**
 * Los opcionales de A, B y C, en el orden en que se muestran y se preguntan. Lo que deja de aplicar (por ejemplo,
 * fechas de servicio si se cambio a productos) no llega al comprobante.
 */
export function billingOptionals(questions: BillingOptionalQuestions): readonly BillingOptionalDef[] {
  const options: readonly BillingOptionalDef[] = [
    {
      available: (context) => Boolean(context.consumer && (context.consumer.offered || context.consumer.required)),
      describe: (current) => describeConsumerIdentity(current),
      key: 'consumidor',
      label: 'Datos del consumidor final',
      owns: ['consumerDocumentType', 'consumerDocumentNumber'],
      required: (context) => (context.consumer?.required ? { reason: consumerIdentificationNotice() } : undefined),
      // El documento es del receptor: con otro, lo escrito antes no se ofrece.
      resetWhen: (context) => context.consumer?.receiver ?? '',
      steps: questions.consumidor,
    },
    {
      available: () => true,
      describe: (current) => current.billingDate ?? 'hoy',
      key: 'fecha',
      label: 'Fecha del comprobante',
      owns: ['billingDate'],
      steps: questions.fecha,
    },
    {
      available: discriminatesIva,
      describe: (current, context) => `${(current.ivaRate ?? context.defaultIvaRate).replace('.', ',')}%`,
      key: 'alicuota',
      label: 'Alícuota de IVA',
      owns: ['ivaRate'],
      resetWhen: copiedFrom,
      steps: questions.alicuota,
    },
    {
      available: (context) => !context.currencyLock,
      describe: describeCurrency,
      key: 'divisas',
      label: 'Moneda extranjera',
      owns: ['currencyCode', 'exchangeRate', 'exchangeRateSource', 'sameCurrency'],
      steps: questions.divisas,
    },
    {
      available: discriminatesIva,
      cleared: () => ({ exemptAmount: undefined, untaxedAmount: undefined }),
      describe: describeAmounts,
      key: 'exento',
      label: 'Importe exento o no gravado',
      owns: ['exemptAmount', 'untaxedAmount'],
      resetWhen: (context) => `${copiedFrom(context)}|${context.exemptFrom ?? ''}`,
      steps: questions.exento,
    },
    {
      available: usesService,
      cleared: () => ({ serviceEndDate: undefined, serviceStartDate: undefined }),
      describe: describeServicePeriod,
      key: 'servicio',
      label: 'Período del servicio',
      owns: ['serviceStartDate', 'serviceEndDate'],
      steps: questions.servicio,
    },
    {
      // Como el CLI: vencimiento en servicios y en la factura FCE; las notas FCE no lo llevan.
      available: (context) =>
        isFceInvoice(context) || (usesService(context) && !context.voucherKind.isElectronicCredit),
      cleared: () => ({ paymentDueDate: undefined }),
      describe: (current) => current.paymentDueDate ?? 'por defecto',
      key: 'vencimiento',
      label: 'Vencimiento del pago',
      owns: ['paymentDueDate'],
      steps: questions.vencimiento,
    },
    {
      available: isFceInvoice,
      describe: (current) => (current.transferMode ?? 'sca').toUpperCase(),
      key: 'transferencia',
      label: 'Modalidad de transferencia',
      owns: ['transferMode'],
      steps: questions.transferencia,
    },
  ];

  // Lo oculto por el flujo (por ejemplo, la alicuota en las notas) cuenta como no disponible.
  return options.map((option) => ({
    ...option,
    available: (context) => !context.hidden?.includes(option.key) && option.available(context),
  }));
}

const CONSUMER_FIELDS: ReadonlySet<string> = new Set(['consumerDocumentNumber', 'consumerDocumentType']);

/**
 * Los campos de la entrada que cargan los opcionales, para las reglas: todos menos el documento del consumidor, que va
 * como el del receptor.
 */
export function advancedInputFields(current: AdvancedOptions): Partial<BillingCommandInput> {
  return Object.fromEntries(
    Object.entries(current).filter(([key]) => !CONSUMER_FIELDS.has(key)),
  ) as Partial<BillingCommandInput>;
}
