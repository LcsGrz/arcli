/**
 * Interpreta montos escritos como en Argentina: `150000`, `150.000`, `1500,50`, `1.500,50` o `1500.50`.
 * Con coma, los puntos son separadores de miles. Sin coma, un punto seguido de exactamente
 * 3 digitos (o varios puntos) tambien son miles; si no, el punto es decimal.
 */
export function parseAmountInput(raw: string): number | undefined {
  const value = raw
    .trim()
    .replace(/^\$\s*/, '')
    .replace(/\s/g, '');

  if (!/^[\d.,]+$/.test(value)) {
    return undefined;
  }

  let normalized: string;

  if (value.includes(',')) {
    if (value.indexOf(',') !== value.lastIndexOf(',')) {
      return undefined;
    }

    normalized = value.replace(/\./g, '').replace(',', '.');
  } else {
    const dots = value.split('.').length - 1;
    const isThousands = dots > 1 || /^\d{1,3}\.\d{3}$/.test(value);

    normalized = isThousands ? value.replace(/\./g, '') : value;
  }

  const amount = Number(normalized);

  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : undefined;
}
