import { describe, expect, it } from 'vitest';

import { exchangeRateWarnings } from '../billing.currency';

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
