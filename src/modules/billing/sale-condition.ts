import { z } from 'zod';

/**
 * Condiciones de venta de Comprobantes en linea. ARCA no las recibe en `wsfe`: solo se imprimen en el PDF. Un texto
 * que no es una de estas claves se imprime tal cual.
 */
export const SALE_CONDITION_LABELS = {
  contado: 'Contado',
  'tarjeta-debito': 'Tarjeta de Débito',
  'tarjeta-credito': 'Tarjeta de Crédito',
  'cuenta-corriente': 'Cuenta Corriente',
  cheque: 'Cheque',
  transferencia: 'Transferencia Bancaria',
  'otros-medios-electronicos': 'Otros medios de pago electrónico',
  otra: 'Otra',
} as const;

export type SaleConditionKey = keyof typeof SALE_CONDITION_LABELS;

export const SALE_CONDITION_KEYS = Object.keys(SALE_CONDITION_LABELS) as SaleConditionKey[];

export const saleConditionSchema = z.string().trim().min(1).max(100);

function isSaleConditionKey(value: string): value is SaleConditionKey {
  return Object.hasOwn(SALE_CONDITION_LABELS, value);
}

/** Lo que imprime el PDF: el nombre de una clave conocida, o el texto que se paso. */
export function formatSaleCondition(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  const key = trimmed.toLowerCase();

  return isSaleConditionKey(key) ? SALE_CONDITION_LABELS[key] : trimmed;
}
