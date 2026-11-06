import { describe, expect, it } from 'vitest';

import { formatDecimalLabel, formatMoneyLabel, formatTaxIdLabel } from '../billing.labels';

describe('formatMoneyLabel', () => {
  it.each([
    [1500, undefined, '$ 1.500'],
    [1500.5, undefined, '$ 1.500,50'],
    [1500.5, 'PES', '$ 1.500,50'],
    [1500.5, 'ARS', '$ 1.500,50'],
    [1500.5, 'DOL', '1.500,50 USD'],
    [1500, 'USD', '1.500 USD'],
    [12.5, '011', '12,50 UYU'],
    [10, 'XXX', '10 XXX'],
  ])('escribe %s en %s como %s', (value, currency, expected) => {
    expect(formatMoneyLabel(value, currency)).toBe(expected);
  });

  it('muestra N/D si no hay importe', () => {
    expect(formatMoneyLabel(undefined, 'DOL')).toBe('N/D');
  });
});

describe('otros datos', () => {
  it('la cotizacion lleva 2 decimales o mas', () => {
    expect(formatDecimalLabel(1250.5)).toBe('1.250,50');
    expect(formatDecimalLabel(1)).toBe('1');
  });

  it('un CUIT ausente sale como N/D', () => {
    expect(formatTaxIdLabel(undefined)).toBe('N/D');
    expect(formatTaxIdLabel(20333333334)).toBe('20-33333333-4');
  });
});
