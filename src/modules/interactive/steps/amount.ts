import { isForeignCurrency } from '../../billing/billing.currency';
import { toIsoCurrencyCode } from '../../billing/currency-codes';

/**
 * La pregunta del monto, con la moneda si no es pesos (REV-74, #12): "Monto total en USD:", o "Monto total:" en pesos
 * o si la moneda todavia no se sabe. `currencyCode` puede ser el de ARCA (`DOL`) o el ISO; se muestra el ISO.
 */
export function amountQuestion(label: string, currencyCode: string | undefined): string {
  return currencyCode && isForeignCurrency({ currencyCode })
    ? `${label} en ${toIsoCurrencyCode(currencyCode)}:`
    : `${label}:`;
}
