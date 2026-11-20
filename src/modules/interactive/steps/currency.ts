import { DEFAULT_CURRENCY_CODE } from '../../billing/billing.constants';
import { isForeignCurrency } from '../../billing/billing.currency';
import type { BillingCommandInput } from '../../billing/billing.schemas';
import { toIsoCurrencyCode } from '../../billing/currency-codes';
import { SERVICES_EXPORT_TYPE } from '../../export/export.mappers';
import type { ExportType } from '../../export/export.types';

/** La moneda de un comprobante de A, B o C, como pagan y la cotizacion: lo que escriben las preguntas de la moneda. */
export type CurrencyChoice = Pick<
  BillingCommandInput,
  'currencyCode' | 'exchangeRate' | 'exchangeRateSource' | 'sameCurrency'
>;

/**
 * La moneda no se puede cambiar, con el motivo (REV-73): el monto ya esta confirmado en esa moneda. Las preguntas de
 * la moneda no ofrecen otra; si es extranjera, igual preguntan como te pagan, con `reason` como aviso.
 */
export interface CurrencyLock {
  /** ISO (`USD`) o `ARS`. */
  readonly code: string;
  readonly reason: string;
}

/** La moneda extranjera de un comprobante emitido, con su codigo ISO; `undefined` si era en pesos. */
export function foreignCurrencyOf(original: { readonly currency?: string } | undefined): string | undefined {
  const currency = original?.currency;

  return currency && isForeignCurrency({ currencyCode: currency }) ? toIsoCurrencyCode(currency) : undefined;
}

/**
 * En "Repetir", la moneda queda trabada en la del original cuando el monto ya esta en esa moneda: con "¿Mismo monto?
 * Sí" (el total del original, en pesos o no) y, en moneda extranjera, tambien con otro monto, que se escribe en esa
 * moneda ("Monto total en USD:"). Con otro monto en pesos, la moneda se elige en los opcionales, como en "Emitir
 * factura": el monto es en la moneda que se elija.
 */
export function repeatCurrencyLock(
  original: { readonly currency?: string } | undefined,
  sameAmount: boolean | undefined,
): CurrencyLock | undefined {
  const foreign = foreignCurrencyOf(original);

  if (foreign) {
    return {
      code: foreign,
      reason: `El comprobante original era en ${foreign}: se repite en ${foreign} con una cotización nueva.`,
    };
  }

  return original && sameAmount === true
    ? { code: DEFAULT_CURRENCY_CODE, reason: 'El monto confirmado es el del comprobante original, en pesos.' }
    : undefined;
}

/** De una E, lo que decide si la cotizacion se puede escribir. */
export interface ExportExchangeRateCase {
  /** Codigo de ARCA (`DOL`, `PES`) o ISO. */
  readonly currencyCode: string;
  readonly exportType: ExportType;
  /** "¿Te pagan en dólares? Sí" (`--misma-moneda`); en las notas no va (1605). */
  readonly sameCurrency?: boolean;
}

/**
 * Si el asistente pregunta la cotizacion de una E: solo en moneda extranjera (en pesos es 1) y cuando ARCA acepta otra
 * que la suya. En servicios exige la de aduana del dia habil anterior en la factura y la del asociado en la nota (2053,
 * WSFEX v3.1.0); con `--misma-moneda`, la oficial del dia habil anterior (1604, historial 3.0.0). Son las mismas reglas
 * con las que `ExportService` rechaza un `--cotizacion-moneda` distinto: ahi no hay nada que elegir.
 */
export function exportAsksExchangeRate(voucher: ExportExchangeRateCase): boolean {
  return (
    isForeignCurrency({ currencyCode: voucher.currencyCode }) &&
    voucher.exportType !== SERVICES_EXPORT_TYPE &&
    !voucher.sameCurrency
  );
}
