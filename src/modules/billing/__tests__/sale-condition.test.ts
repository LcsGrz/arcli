import { describe, expect, it } from 'vitest';

import { formatSaleCondition } from '../sale-condition';

describe('formatSaleCondition', () => {
  it.each([
    ['contado', 'Contado'],
    ['tarjeta-debito', 'Tarjeta de Débito'],
    ['TRANSFERENCIA', 'Transferencia Bancaria'],
    ['otros-medios-electronicos', 'Otros medios de pago electrónico'],
    ['otra', 'Otra'],
    ['  50% anticipo  ', '50% anticipo'],
  ])('prints %s as %s', (value, expected) => {
    expect(formatSaleCondition(value)).toBe(expected);
  });

  it('prints nothing without a value', () => {
    expect(formatSaleCondition(undefined)).toBeUndefined();
    expect(formatSaleCondition('  ')).toBeUndefined();
  });
});
