import { describe, expect, it } from 'vitest';

import { formatCurrencyLabel } from '../billing.labels';
import { ARCA_CURRENCIES, ISO_CURRENCY_ALIASES, toArcaCurrencyCode, toIsoCurrencyCode } from '../currency-codes';

describe('toArcaCurrencyCode', () => {
  it.each([
    ['ARS', 'PES'],
    ['PES', 'PES'],
    ['usd', 'DOL'],
    [' UYU ', '011'],
    ['011', '011'],
    ['CLP', '033'],
    ['GBP', '021'],
    ['NZD', 'NZD'],
    ['002', '002'],
  ])('%s se envía como %s', (input, expected) => {
    expect(toArcaCurrencyCode(input)).toBe(expected);
  });

  it('un código que no está en la tabla se manda tal cual, en mayúsculas', () => {
    expect(toArcaCurrencyCode('xyz')).toBe('XYZ');
  });
});

describe('toIsoCurrencyCode', () => {
  it.each([
    ['PES', 'ARS'],
    ['060', 'EUR'],
    ['011', 'UYU'],
    ['RUB', 'RUB'],
    ['049', '049'],
  ])('%s se muestra como %s', (input, expected) => {
    expect(toIsoCurrencyCode(input)).toBe(expected);
  });
});

describe('ARCA_CURRENCIES', () => {
  it('no repite códigos de ARCA ni alias ISO', () => {
    const arcaCodes = ARCA_CURRENCIES.map((currency) => currency.arca);

    expect(new Set(arcaCodes).size).toBe(arcaCodes.length);
    expect(new Set(ISO_CURRENCY_ALIASES).size).toBe(ISO_CURRENCY_ALIASES.length);
  });

  it('ningún alias ISO es a la vez el código de ARCA de otra moneda', () => {
    const arcaCodes = new Set(ARCA_CURRENCIES.map((currency) => currency.arca));

    expect(ISO_CURRENCY_ALIASES.filter((iso) => arcaCodes.has(iso))).toEqual([]);
  });
});

describe('formatCurrencyLabel', () => {
  it.each([
    ['PES', 'Pesos argentinos (ARS)'],
    ['DOL', 'Dólares estadounidenses (USD)'],
    ['011', 'Pesos uruguayos (UYU)'],
    ['RUB', 'Rublos (RUB)'],
    ['XYZ', 'XYZ'],
    [undefined, 'N/D'],
  ])('%s → %s', (input, expected) => {
    expect(formatCurrencyLabel(input)).toBe(expected);
  });
});
