import { ARCA_LOCAL_CURRENCY_CODE } from '../billing/billing.currency';
import type { IssuedVoucher } from '../vouchers/voucher-history';

import type { InteractiveChoice } from './choices';
import type { InvoiceCopy } from './invoice-copy';

/**
 * En que moneda va una nota sobre un comprobante: la del asociado o pesos. Una nota sobre una factura en moneda
 * extranjera puede ir en pesos para ajustar una diferencia de cambio: ARCA lo prevé en FCE (10181, WSFEv1 v4.7) y en
 * las notas comunes no controla la moneda.
 */
export type NoteCurrency = 'asociado' | 'pesos';

/** Si la nota deja elegir la moneda: solo si el asociado no esta en pesos. */
export function canChooseNoteCurrency(invoice: Pick<IssuedVoucher, 'currency'> | undefined): boolean {
  const currency = invoice?.currency?.trim().toUpperCase();

  return Boolean(currency && currency !== ARCA_LOCAL_CURRENCY_CODE);
}

/** Las dos opciones, con la moneda del asociado (`DOL`, `060`…) en el texto. */
export function noteCurrencyChoices(invoice: Pick<IssuedVoucher, 'currency'>): Array<InteractiveChoice<NoteCurrency>> {
  const currency = invoice.currency?.trim().toUpperCase() ?? ARCA_LOCAL_CURRENCY_CODE;

  return [
    { description: 'Con la misma cotización', name: `En ${currency}, como el comprobante`, value: 'asociado' },
    { description: 'Por ejemplo, para ajustar una diferencia de cambio', name: 'En pesos', value: 'pesos' },
  ];
}

/** La moneda y la cotizacion de la nota: las del asociado o pesos, con cotizacion 1. */
export function resolveNoteCurrency(
  copy: Pick<InvoiceCopy, 'currencyCode' | 'exchangeRate'> | undefined,
  choice: NoteCurrency | undefined,
): { readonly currencyCode?: string; readonly exchangeRate?: number } {
  if (choice === 'pesos') {
    return { currencyCode: ARCA_LOCAL_CURRENCY_CODE, exchangeRate: undefined };
  }

  return { currencyCode: copy?.currencyCode, exchangeRate: copy?.exchangeRate };
}
