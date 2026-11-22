import { describe, expect, it } from 'vitest';

import { canChooseNoteCurrency, noteCurrencyChoices, resolveNoteCurrency } from '../note-currency';

describe('moneda de una nota sobre un comprobante (REGLAS-4)', () => {
  it('deja elegir solo si el asociado esta en moneda extranjera', () => {
    expect(canChooseNoteCurrency({ currency: 'DOL' })).toBe(true);
    expect(canChooseNoteCurrency({ currency: '060' })).toBe(true);
    expect(canChooseNoteCurrency({ currency: 'PES' })).toBe(false);
    expect(canChooseNoteCurrency({})).toBe(false);
    expect(canChooseNoteCurrency(undefined)).toBe(false);
  });

  it('ofrece la moneda del asociado, con su codigo ISO, o pesos', () => {
    expect(noteCurrencyChoices({ currency: 'DOL' }).map(({ name, value }) => [name, value])).toEqual([
      ['En USD, como el comprobante', 'asociado'],
      ['En pesos', 'pesos'],
    ]);
    expect(noteCurrencyChoices({ currency: '060' })[0]?.name).toBe('En EUR, como el comprobante');
  });

  it('en pesos va con cotizacion 1; si no, con la moneda y la cotizacion del asociado', () => {
    const copy = { currencyCode: 'DOL', exchangeRate: 1450 };

    expect(resolveNoteCurrency(copy, 'pesos')).toEqual({ currencyCode: 'PES', exchangeRate: undefined });
    expect(resolveNoteCurrency(copy, 'asociado')).toEqual(copy);
    expect(resolveNoteCurrency(copy, undefined)).toEqual(copy);
  });
});
