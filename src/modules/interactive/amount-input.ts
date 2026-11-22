import {
  EXCHANGE_RATE_DECIMALS,
  formatArgentineAmountInput,
  parseArgentineAmount,
} from '../../lib/numbers/argentine-amount';

/** Monto escrito en el modo interactivo, con las mismas reglas que los flags: `1.500,50`. */
export function parseAmountInput(raw: string): number | undefined {
  const result = parseArgentineAmount(raw);

  return result.ok ? result.value : undefined;
}

/** Cotizacion escrita en el modo interactivo: como un monto, pero con hasta 6 decimales. */
export function parseExchangeRateInput(raw: string): number | undefined {
  const result = parseArgentineAmount(raw, { maxDecimals: EXCHANGE_RATE_DECIMALS });

  return result.ok ? result.value : undefined;
}

/** Un monto o cotizacion ya respondido, escrito de nuevo como se tipea (`1500,50`), para ofrecerlo al volver. */
export function amountInputText(value: number | undefined): string | undefined {
  return value === undefined ? undefined : formatArgentineAmountInput(value);
}
