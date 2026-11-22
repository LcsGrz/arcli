/** Pesos del bloque 1 (banco y sucursal): los 7 primeros dígitos; el 8.º es el verificador. */
const BANK_BLOCK_WEIGHTS = [7, 1, 3, 9, 7, 1, 3] as const;
/** Pesos del bloque 2 (cuenta): los 13 dígitos siguientes; el 14.º (el último del CBU) es el verificador. */
const ACCOUNT_BLOCK_WEIGHTS = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3] as const;

export type CbuParseResult =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string };

/** Verificador de un bloque del CBU: `(10 − suma ponderada % 10) % 10`. */
function computeCheckDigit(digits: string, weights: readonly number[]): number {
  const sum = weights.reduce((total, weight, index) => total + weight * Number(digits[index]), 0);

  return (10 - (sum % 10)) % 10;
}

function hasValidCheckDigit(block: string, weights: readonly number[]): boolean {
  return computeCheckDigit(block, weights) === Number(block[weights.length]);
}

/**
 * CBU de 22 dígitos, sin separadores. Controla el largo y los dos dígitos verificadores (bloque de banco y
 * sucursal, y bloque de la cuenta); no controla que el banco exista. Devuelve los 22 dígitos o el motivo.
 */
export function parseCbu(raw: string): CbuParseResult {
  const value = raw.trim();

  if (!/^\d{22}$/.test(value)) {
    return { ok: false, reason: 'debe tener 22 dígitos' };
  }

  if (!hasValidCheckDigit(value.slice(0, 8), BANK_BLOCK_WEIGHTS)) {
    return {
      ok: false,
      reason: 'no coincide el dígito verificador del bloque de banco y sucursal (los primeros 8 dígitos)',
    };
  }

  if (!hasValidCheckDigit(value.slice(8), ACCOUNT_BLOCK_WEIGHTS)) {
    return { ok: false, reason: 'no coincide el dígito verificador del bloque de la cuenta (los últimos 14 dígitos)' };
  }

  return { ok: true, value };
}

/** El mensaje de error de un CBU inválido, el mismo en flags, `--cargar`, config y modo interactivo. */
export function describeInvalidCbu(reason: string, value?: string): string {
  return `El CBU${value === undefined ? '' : ` "${value}"`} no es válido: ${reason}. Revisá que esté bien escrito.`;
}
