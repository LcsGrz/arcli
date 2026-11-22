import { describe, expect, it } from 'vitest';

import {
  EXCHANGE_RATE_DECIMALS,
  formatArgentineAmount,
  formatArgentineAmountInput,
  formatArgentineMoney,
  formatExchangeRate,
  hasAtMostDecimals,
  parseArgentineAmount,
  roundToCents,
} from '../argentine-amount';

describe('parseArgentineAmount', () => {
  it.each([
    ['15000', 15000],
    ['15.000', 15000],
    ['1.500.000', 1500000],
    ['100.555', 100555],
    ['1500,5', 1500.5],
    ['1500,50', 1500.5],
    ['1.500,50', 1500.5],
    ['0,01', 0.01],
    ['$ 2.000', 2000],
    ['$2.000,25', 2000.25],
    [' 12 ', 12],
  ])('interpreta %s como %s', (raw, expected) => {
    expect(parseArgentineAmount(raw)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['1500.50', 'usá coma para los decimales'],
    ['1500.5', 'usá coma para los decimales'],
    ['15.00', 'usá coma para los decimales'],
    ['1500,555', 'usá hasta 2 decimales'],
    ['0', 'tiene que ser mayor a 0'],
    ['0,00', 'tiene que ser mayor a 0'],
  ])('rechaza %s: %s', (raw, reason) => {
    expect(parseArgentineAmount(raw)).toEqual({ ok: false, reason });
  });

  it.each(['', 'abc', '12abc', '1,5,0', '-10', '10e3', '1500.555', '1.50.000', '1.500.', ',50', 'Infinity'])(
    'rechaza %s por formato',
    (raw) => {
      expect(parseArgentineAmount(raw)).toEqual({ ok: false, reason: expect.stringContaining('punto para miles') });
    },
  );

  it('acepta mas decimales cuando se piden, como en una cotizacion', () => {
    expect(parseArgentineAmount('1.452,123456', { maxDecimals: EXCHANGE_RATE_DECIMALS })).toEqual({
      ok: true,
      value: 1452.123456,
    });
    expect(parseArgentineAmount('1,1234567', { maxDecimals: EXCHANGE_RATE_DECIMALS })).toEqual({
      ok: false,
      reason: 'usá hasta 6 decimales',
    });
  });
});

describe('formatArgentineAmountInput', () => {
  it.each([
    [1234.5, '1234,50'],
    [1500, '1500'],
    [0.01, '0,01'],
  ])('escribe %s como %s', (value, expected) => {
    expect(formatArgentineAmountInput(value)).toBe(expected);
    expect(parseArgentineAmount(expected)).toEqual({ ok: true, value });
  });
});

describe('formatArgentineAmount', () => {
  it.each([
    [0, '0'],
    [5, '5'],
    [1500, '1.500'],
    [123456.5, '123.456,50'],
    [123456.12, '123.456,12'],
    [1500000.05, '1.500.000,05'],
    [1500.004, '1.500'],
    [1499.999, '1.500'],
  ])('escribe %s como %s', (value, expected) => {
    expect(formatArgentineAmount(value)).toBe(expected);
    expect(formatArgentineMoney(value)).toBe(`$ ${expected}`);
  });

  it('se puede volver a leer con parseArgentineAmount', () => {
    expect(parseArgentineAmount(formatArgentineMoney(123456.5))).toEqual({ ok: true, value: 123456.5 });
  });
});

describe('formatExchangeRate', () => {
  it.each([
    [1, '1'],
    [1250, '1.250'],
    [1250.5, '1.250,50'],
    [1250.12, '1.250,12'],
    [1250.123456, '1.250,123456'],
  ])('escribe %s como %s', (value, expected) => {
    expect(formatExchangeRate(value)).toBe(expected);
  });
});

describe('hasAtMostDecimals', () => {
  it.each([
    [100, 2, true],
    [100.55, 2, true],
    [0.1, 2, true],
    [100.555, 2, false],
    [1452.123456, 6, true],
    [1452.1234567, 6, false],
    [Number.NaN, 2, false],
  ])('%s con hasta %s decimales: %s', (value, decimals, expected) => {
    expect(hasAtMostDecimals(value, decimals)).toBe(expected);
  });
});

describe('roundToCents', () => {
  it.each([
    [1500, 1500],
    [1500.5, 1500.5],
    // Sumas y restas de importes de 2 decimales, que es lo que redondea hoy (PDF y total de la E).
    [0.1 + 0.2, 0.3],
    [1452.1 + 304.94, 1757.04],
    [1000.3 - 210.1, 790.2],
  ])('%s queda en %s', (value, expected) => {
    expect(roundToCents(value)).toBe(expected);
  });

  it.each([
    [0.005, 0.01],
    [0.015, 0.02],
    [0.125, 0.13],
    [1.235, 1.24],
    [10.005, 10.01],
    [1234.565, 1234.57],
  ])('la mitad exacta %s sube a %s', (value, expected) => {
    expect(roundToCents(value)).toBe(expected);
  });

  // Antes, con `Math.round(value * 100)` sobre float, estas bajaban: 1.005 * 100 da 100.49999999999999.
  it.each([
    [1.005, 1.01],
    [0.285, 0.29],
    [1.045, 1.05],
  ])('la mitad exacta %s sube a %s, también donde el float la dejaba abajo', (value, expected) => {
    expect(roundToCents(value)).toBe(expected);
  });

  it.each([
    [-1.005, -1.01],
    [-0.125, -0.13],
    [-1500.5, -1500.5],
  ])('con signo, la mitad se aleja del cero como Big.roundHalfUp en billing: %s da %s', (value, expected) => {
    expect(roundToCents(value)).toBe(expected);
  });

  it('un importe que ya tiene 2 decimales no cambia', () => {
    for (let cents = 0; cents <= 200_000; cents += 7) {
      const amount = cents / 100;

      expect(roundToCents(amount)).toBe(amount);
    }
  });

  it('un valor no finito sale igual', () => {
    expect(roundToCents(Number.NaN)).toBeNaN();
    expect(roundToCents(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });
});
