import { describe, expect, it } from 'vitest';

import {
  validateCbu,
  validateDni,
  validateOptionalDate,
  validatePointOfSale,
  validatePositiveInteger,
} from '../validators';

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

describe('validateCbu', () => {
  it('usa la misma regla que `--cbu`: 22 dígitos y los dos verificadores', () => {
    expect(validateCbu('0110599520000012345678')).toBe(true);
    expect(validateCbu('123')).toMatch(/22 dígitos/);
    expect(validateCbu('0110599420000012345678')).toMatch(/bloque de banco y sucursal/);
    expect(validateCbu('0110599520000012345677')).toMatch(/bloque de la cuenta/);
  });
});

describe('validateDni', () => {
  it.each(['543210', '12.345.678', '1234567'])('acepta %s', (value) => {
    expect(validateDni(value)).toBe(true);
  });

  it.each(['12345', '123456789'])('rechaza %s', (value) => {
    expect(validateDni(value)).toBe('El DNI tiene de 6 a 8 dígitos.');
  });
});
