import { DEFAULT_CURRENCY_CODE } from '../../billing/billing.constants';
import type { BillingCommandInput } from '../../billing/billing.schemas';
import { amountInPesos, type AmountInPesosInput, reachesConsumerThreshold } from '../consumer-identification';

/** Monto, moneda y fecha del comprobante: con la fecha se consulta la cotizacion oficial con `--misma-moneda` (10038). */
export type ConsumerAmount = AmountInPesosInput & Pick<Partial<BillingCommandInput>, 'billingDate'>;

/**
 * El opcional "Datos del consumidor final" en un flujo (REV-66): solo con el receptor consumidor final. Por debajo del
 * tope de la RG 5700/2025 es un opcional (si el flujo lo ofrece); desde el tope, una pregunta obligatoria.
 */
export interface ConsumerContext {
  /** Si se ofrece como opcional: en una nota sobre una factura de ARCA, el receptor es el de la factura y no. */
  readonly offered: boolean;
  /** El total en pesos ya se sabe y llega al tope. */
  readonly required: boolean;
  /** Quien es el receptor, como una clave: si cambia, el documento escrito antes se olvida. */
  readonly receiver: string;
}

/** La consulta de la cotizacion oficial que da el total en pesos, como la haria el CLI sin `--cm`. */
export function officialRateQuery(amount: ConsumerAmount): {
  readonly billingDate?: string;
  readonly currencyCode: string;
  readonly sameCurrency: boolean;
} {
  return {
    billingDate: amount.billingDate,
    currencyCode: amount.currencyCode ?? DEFAULT_CURRENCY_CODE,
    sameCurrency: amount.sameCurrency ?? false,
  };
}

/**
 * El monto con la cotizacion oficial ya consultada, si sin ella el total en pesos no se sabe (moneda extranjera sin
 * cotizacion o cobrada en esa moneda): con `--misma-moneda` la cotizacion tambien es la oficial.
 */
export function withOfficialRate(amount: ConsumerAmount, officialRate: number | undefined): ConsumerAmount {
  return officialRate === undefined || amountInPesos(amount) !== undefined
    ? amount
    : { ...amount, exchangeRate: officialRate, sameCurrency: false };
}

/** Si el total en pesos todavia no se sabe: hace falta la cotizacion oficial. */
export function needsOfficialRate(amount: ConsumerAmount, officialRate: number | undefined): boolean {
  return amountInPesos(withOfficialRate(amount, officialRate)) === undefined;
}

/** El contexto del opcional del consumidor final, o `undefined` si el receptor no es consumidor final. */
export function consumerContext(options: {
  readonly amount: ConsumerAmount;
  readonly documentType: BillingCommandInput['documentType'] | undefined;
  readonly officialRate?: number;
  readonly offered: boolean;
  readonly receiver: string;
}): ConsumerContext | undefined {
  if (options.documentType !== 'consumidor-final') {
    return undefined;
  }

  return {
    offered: options.offered,
    receiver: options.receiver,
    required: reachesConsumerThreshold(withOfficialRate(options.amount, options.officialRate)),
  };
}
