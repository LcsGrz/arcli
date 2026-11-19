import { describe, expect, it } from 'vitest';

import { exchangeRateWarnings, validateExchangeRateRange } from '../billing.currency';

describe('exchangeRateWarnings', () => {
  it('avisa que la clave cotizacion de la config está deprecada', () => {
    const [warning] = exchangeRateWarnings({ currencyCode: 'usd', exchangeRate: 1200.5, exchangeRateSource: 'config' });

    expect(warning).toContain('USD (1.200,50)');
    expect(warning).toContain('deprecada');
    expect(warning).toContain('arcli config eliminar cotizacion');
  });

  it('avisa que se usó la cotización oficial de ARCA', () => {
    expect(exchangeRateWarnings({ currencyCode: 'USD', exchangeRate: 1415.25, exchangeRateSource: 'arca' })).toEqual([
      'Sin `--cm` se usa la cotización oficial de ARCA para USD (1.415,25). Para usar otra, `--cotizacion-moneda`.',
    ]);
  });

  it('no avisa si la cotización la indicó el usuario', () => {
    expect(exchangeRateWarnings({ currencyCode: 'USD', exchangeRate: 1300 })).toEqual([]);
  });
});

describe('validateExchangeRateRange: bordes del rango de la 10119 (TEST-17)', () => {
  const check =
    (exchangeRate: number, official = 1000) =>
    () =>
      validateExchangeRateRange({ currencyCode: 'USD', exchangeRate }, official);

  it('acepta las cotizaciones justo en el 2 % y en el 500 % de la oficial', () => {
    expect(check(20)).not.toThrow();
    expect(check(5000)).not.toThrow();
  });

  it('rechaza apenas afuera del rango', () => {
    expect(check(19.99)).toThrow(/de 20 a 5\.000/);
    expect(check(5000.01)).toThrow(/de 20 a 5\.000/);
  });

  it('con la oficial en 0 no compara: no hay rango contra el que validar', () => {
    expect(check(1200, 0)).not.toThrow();
  });
});
