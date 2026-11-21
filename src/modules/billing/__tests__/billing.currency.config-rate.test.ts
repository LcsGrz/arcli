import { describe, expect, it } from 'vitest';

import { resolveConfigExchangeRate } from '../billing.currency';

const rate = (overrides: Partial<Parameters<typeof resolveConfigExchangeRate>[0]> = {}) =>
  resolveConfigExchangeRate({
    configCurrencyCode: 'USD',
    configExchangeRate: 1400,
    currencyCode: 'USD',
    sameCurrency: false,
    ...overrides,
  });

describe('resolveConfigExchangeRate', () => {
  it('en la moneda de la config, sin --misma-moneda, va la cotización de la config', () => {
    expect(rate()).toBe(1400);
    // DOL y USD son la misma moneda.
    expect(rate({ currencyCode: 'DOL' })).toBe(1400);
  });

  it('con --misma-moneda no aplica: ARCA exige la oficial', () => {
    expect(rate({ sameCurrency: true })).toBeUndefined();
  });

  it('en pesos no aplica', () => {
    expect(rate({ currencyCode: 'ARS' })).toBeUndefined();
    expect(rate({ currencyCode: undefined })).toBeUndefined();
  });

  it('con otra moneda extranjera en la config no aplica: la de USD no vale para EUR', () => {
    expect(rate({ currencyCode: 'EUR' })).toBeUndefined();
  });

  it('sin moneda en la config, o en pesos, vale para cualquier extranjera', () => {
    expect(rate({ configCurrencyCode: undefined, currencyCode: 'EUR' })).toBe(1400);
    expect(rate({ configCurrencyCode: 'PES', currencyCode: 'EUR' })).toBe(1400);
  });

  it('sin cotización en la config, o con 1 (el default guardado), no hay', () => {
    expect(rate({ configExchangeRate: undefined })).toBeUndefined();
    expect(rate({ configExchangeRate: 1 })).toBeUndefined();
  });
});
