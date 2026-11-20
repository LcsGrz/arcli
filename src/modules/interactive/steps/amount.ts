import { DEFAULT_CURRENCY_CODE } from '../../billing/billing.constants';
import { isForeignCurrency } from '../../billing/billing.currency';
import { toIsoCurrencyCode } from '../../billing/currency-codes';
import type { WizardFinalize } from '../wizard';

/** La moneda como se compara y se nombra: el ISO (`USD`, aunque venga `DOL`), o `ARS` en pesos o sin moneda. */
export function amountCurrencyCode(currencyCode: string | undefined): string {
  return currencyCode && isForeignCurrency({ currencyCode }) ? toIsoCurrencyCode(currencyCode) : DEFAULT_CURRENCY_CODE;
}

/**
 * La pregunta del monto, con la moneda si no es pesos (REV-74, #12): "Monto total en USD:", o "Monto total:" en pesos
 * o si la moneda todavia no se sabe. `currencyCode` puede ser el de ARCA (`DOL`) o el ISO; se muestra el ISO.
 */
export function amountQuestion(label: string, currencyCode: string | undefined): string {
  const code = amountCurrencyCode(currencyCode);

  return code === DEFAULT_CURRENCY_CODE ? `${label}:` : `${label} en ${code}:`;
}

/**
 * El monto se escribio en una moneda (`asked`, la que nombro la pregunta) y el comprobante salio en otra (`final`,
 * cambiada despues en los opcionales): el numero no vale en la moneda nueva y hay que volver a escribirlo. `undefined`
 * si coinciden o si el monto no se pregunto (por ejemplo, "¿Mismo monto? Sí", con la moneda trabada).
 */
function amountCurrencyFailure(asked: string | undefined, final: string | undefined): string | undefined {
  if (asked === undefined || amountCurrencyCode(asked) === amountCurrencyCode(final)) {
    return undefined;
  }

  const code = amountCurrencyCode(final);
  const name = code === DEFAULT_CURRENCY_CODE ? 'pesos' : code;

  return `Cambiaste la moneda a ${name}: escribí el monto en ${name}.`;
}

/**
 * La regla de la moneda del monto en `finalize` (REV-74, #12): si se escribio en otra moneda que la del comprobante,
 * vuelve a la pregunta del monto (la que escribe `amountCurrency`), que nombra la moneda nueva.
 */
export function amountCurrencyFinalize(
  asked: string | undefined,
  final: string | undefined,
): ReturnType<WizardFinalize<unknown>> {
  const message = amountCurrencyFailure(asked, final);

  return message === undefined ? undefined : { field: AMOUNT_CURRENCY_FIELD, message };
}

/** El campo que escribe la pregunta del monto con su moneda. */
export const AMOUNT_CURRENCY_FIELD = 'amountCurrency';
