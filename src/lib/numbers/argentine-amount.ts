import Big from 'big.js';

/** Decimales de un importe en ARCA. */
export const AMOUNT_DECIMALS = 2;

/** Decimales de una cotizacion en ARCA (MonCotiz). */
export const EXCHANGE_RATE_DECIMALS = 6;

export type ArgentineAmountResult =
  { readonly ok: true; readonly value: number } | { readonly ok: false; readonly reason: string };

const FORMAT_HINT = 'usá punto para miles y coma para decimales, por ejemplo 15000, 15.000 o 1.500,50';

/**
 * Interpreta un monto escrito como en Argentina: el punto separa miles y la coma separa decimales.
 * `15000`, `15.000`, `1500,50` y `1.500,50` son validos; `1500.50` no, porque un grupo de miles
 * siempre tiene 3 digitos. Acepta un `$` adelante y espacios.
 */
export function parseArgentineAmount(
  raw: string,
  options: { readonly maxDecimals?: number } = {},
): ArgentineAmountResult {
  const maxDecimals = options.maxDecimals ?? AMOUNT_DECIMALS;
  const value = raw.trim().replace(/^\$/, '').replace(/\s/g, '');
  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/.exec(value);

  if (!match) {
    return { ok: false, reason: /^\d+\.\d{1,2}$/.test(value) ? 'usá coma para los decimales' : FORMAT_HINT };
  }

  const [, integerPart = '', decimalPart = ''] = match;

  if (decimalPart.length > maxDecimals) {
    return { ok: false, reason: `usá hasta ${maxDecimals} decimales` };
  }

  const amount = Number(`${integerPart.replace(/\./g, '')}.${decimalPart || '0'}`);

  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: 'tiene que ser mayor a 0' };
  }

  return { ok: true, value: amount };
}

export function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Escribe un numero como lo lee `parseArgentineAmount`: `1234.5` pasa a `1234,5`. */
export function formatArgentineAmountInput(value: number): string {
  return String(value).replace('.', ',');
}

const AMOUNT_FORMATTER = new Intl.NumberFormat('es-AR', {
  maximumFractionDigits: AMOUNT_DECIMALS,
  minimumFractionDigits: AMOUNT_DECIMALS,
});

/** Importe para leer, sin simbolo: `1500` pasa a `1.500` y `1500.5` a `1.500,50`. Sin centavos no se muestra `,00`. */
export function formatArgentineAmount(value: number): string {
  return AMOUNT_FORMATTER.format(value).replace(/,00$/, '');
}

/** Importe en pesos para leer: `$ 1.500` o `$ 1.500,50`, con el espacio que usa la plantilla del PDF. */
export function formatArgentineMoney(value: number): string {
  return `$ ${formatArgentineAmount(value)}`;
}

/** `true` si el numero no tiene mas de `decimals` decimales: 100.55 si, 100.555 no. */
export function hasAtMostDecimals(value: number, decimals: number): boolean {
  return Number.isFinite(value) && new Big(value).round(decimals, Big.roundDown).eq(value);
}
