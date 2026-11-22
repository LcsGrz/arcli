import { describe, expect, it } from 'vitest';

import { getVoucherKindByShortcut } from '../../../modules/billing/voucher-kind-map';
import {
  validateAmount,
  validateBillingDate,
  validateCbu,
  validateCuil,
  validateCuit,
  validateDate,
  validateDni,
  validateExchangeRate,
  validateExportVoucherDate,
  validateOptionalAmount,
  validateOptionalCbuAlias,
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

describe('lo que una persona tipea mal', () => {
  it.each([
    ['monto', validateAmount, ['abc', '1.5.00', '-10', '']],
    ['CUIT', validateCuit, ['20-12345678-0', '123', 'veinte']],
    ['CUIL', validateCuil, ['20123', 'x']],
    ['alias del CBU', validateOptionalCbuAlias, ['corto', 'con espacios no', 'ñandú.alias', 'a'.repeat(21)]],
    ['cotización', validateExchangeRate, ['abc', '1', '1,0', '1.234,5678901']],
  ] as const)('%s: rechaza lo invalido con un mensaje', (_, validate, values) => {
    for (const value of values) {
      expect(validate(value), value).toEqual(expect.any(String));
    }
  });

  it('acepta los formatos argentinos y los alias validos, y vacio en lo opcional', () => {
    expect(validateAmount('1.500,50')).toBe(true);
    expect(validateCuit('20-12345678-6')).toBe(true);
    expect(validateCuil('20123456786')).toBe(true);
    expect(validateOptionalCbuAlias('')).toBe(true);
    expect(validateOptionalCbuAlias('mi.alias-cbu')).toBe(true);
    expect(validateOptionalAmount('  ')).toBe(true);
    expect(validateOptionalAmount('x')).toEqual(expect.any(String));
    expect(validateExchangeRate('1.185,50')).toBe(true);
  });

  it('la fecha del comprobante usa la ventana del CLI segun el concepto', () => {
    const now = new Date('2026-11-18T15:00:00-03:00');
    const fc = getVoucherKindByShortcut('fc')!;

    expect(validateBillingDate('18/11/2026', 'productos', fc, now)).toBe(true);
    expect(validateBillingDate('31/02/2026', 'productos', fc, now)).toMatch(/Fecha inválida/);
    expect(validateBillingDate('01/01/2026', 'productos', fc, now)).toEqual(expect.any(String));
  });

  // TUI-18: las relativas, con la misma ventana que una fecha escrita a mano.
  it('acepta hoy, ayer, +N y -N, con la ventana de ARCA sobre la fecha resuelta', () => {
    const now = new Date('2026-11-18T15:00:00-03:00');
    const fc = getVoucherKindByShortcut('fc')!;

    expect(validateBillingDate('hoy', 'productos', fc, now)).toBe(true);
    expect(validateBillingDate('-5', 'productos', fc, now)).toBe(true);
    expect(validateBillingDate('-6', 'productos', fc, now)).toEqual(expect.any(String));
    expect(validateExportVoucherDate('ayer', 2, now)).toBe(true);
    expect(validateDate('+1000', now)).toMatch(/hasta 999/);
    expect(validateDate('mes-pasado', now)).toMatch(/Fecha inválida/);
  });
});
