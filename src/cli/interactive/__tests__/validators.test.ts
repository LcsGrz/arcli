import { describe, expect, it } from 'vitest';

import { validateOptionalDate, validatePointOfSale, validatePositiveInteger } from '../validators';

describe('validatePositiveInteger', () => {
  const validateNumber = validatePositiveInteger('El número');

  it.each(['1', '45'])('acepta %s', (value) => {
    expect(validateNumber(value)).toBe(true);
  });

  it.each(['0', '-1', '1,5', 'abc', ''])('rechaza %s nombrando el dato', (value) => {
    expect(validateNumber(value)).toBe('El número tiene que ser un número entero positivo.');
  });

  it('el punto de venta usa la misma regla', () => {
    expect(validatePointOfSale('0')).toBe('El punto de venta tiene que ser un número entero positivo.');
    expect(validatePointOfSale('4')).toBe(true);
  });
});

describe('validateOptionalDate', () => {
  it('vacío vale; si no, tiene que ser una fecha', () => {
    expect(validateOptionalDate('  ')).toBe(true);
    expect(validateOptionalDate('15/10/2026')).toBe(true);
    expect(validateOptionalDate('32/10/2026')).toMatch(/Fecha inválida/);
  });
});
