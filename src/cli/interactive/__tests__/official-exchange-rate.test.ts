import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingService } from '../../../modules/billing/billing.service';
import { exchangeRateSuggestionLoader, officialExchangeRateLoader } from '../official-exchange-rate';

vi.mock('../../spinner', () => ({ startSpinner: () => undefined }));

const loader = (getQuotation: (currencyCode: string, arcaDate?: string) => Promise<number>) =>
  officialExchangeRateLoader({ billingGateway: { getQuotation } as never, service: new BillingService() });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-18T15:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('officialExchangeRateLoader', () => {
  it('consulta la oficial de ARCA como el CLI sin --cm, una vez por moneda', async () => {
    const getQuotation = vi.fn(async (currencyCode: string) => (currencyCode === 'DOL' ? 1450 : 1600));
    const load = loader(getQuotation);

    expect(await load({ currencyCode: 'USD' })).toBe(1450);
    expect(await load({ currencyCode: 'USD', sameCurrency: false })).toBe(1450);
    expect(await load({ currencyCode: 'EUR' })).toBe(1600);
    expect(getQuotation.mock.calls).toEqual([['DOL'], ['060']]);
  });

  // El tope del consumidor final lo mira sin consultar (`known`), despues de que la pregunta del tope la consulto.
  it('`known` da la ya consultada, por moneda y fecha; sin consultar o si fallo, ninguna', async () => {
    const getQuotation = vi.fn(async (currencyCode: string, arcaDate?: string) => {
      if (currencyCode === '060') {
        throw new Error('Sin conexión');
      }

      return arcaDate ? 1400 : 1450;
    });
    const load = loader(getQuotation);

    expect(load.known({ currencyCode: 'USD' })).toBeUndefined();
    await load({ currencyCode: 'USD' });
    expect(load.known({ currencyCode: 'USD' })).toBe(1450);
    expect(load.known({ billingDate: '16/11/2026', currencyCode: 'USD', sameCurrency: true })).toBeUndefined();
    await load({ billingDate: '16/11/2026', currencyCode: 'USD', sameCurrency: true });
    expect(load.known({ billingDate: '16/11/2026', currencyCode: 'USD', sameCurrency: true })).toBe(1400);
    await load({ currencyCode: 'EUR' });
    expect(load.known({ currencyCode: 'EUR' })).toBeUndefined();
  });

  it('con --misma-moneda y una fecha pasada, la del día hábil anterior a esa fecha (10038), aparte de la de hoy', async () => {
    const getQuotation = vi.fn(async (_currencyCode: string, arcaDate?: string) => (arcaDate ? 1400 : 1450));
    const load = loader(getQuotation);

    expect(await load({ billingDate: '16/11/2026', currencyCode: 'USD', sameCurrency: true })).toBe(1400);
    expect(await load({ currencyCode: 'USD' })).toBe(1450);
    expect(await load({ billingDate: '16/11/2026', currencyCode: 'USD', sameCurrency: true })).toBe(1400);
    expect(getQuotation.mock.calls).toEqual([['DOL', '20261115'], ['DOL']]);
  });

  it('si la consulta falla, no hay oficial (la pregunta arranca vacía) y no la vuelve a intentar', async () => {
    const getQuotation = vi.fn(async () => {
      throw new Error('Sin conexión');
    });
    const load = loader(getQuotation);

    expect(await load({ currencyCode: 'USD' })).toBeUndefined();
    expect(await load({ currencyCode: 'USD' })).toBeUndefined();
    expect(getQuotation).toHaveBeenCalledTimes(1);
  });
});

describe('exchangeRateSuggestionLoader', () => {
  const official = vi.fn(async () => 1450 as number | undefined);

  it('la de la config cuando el CLI la tomaría sin --cm, sin consultar la oficial', async () => {
    const suggest = exchangeRateSuggestionLoader({ cotizacionPorDefecto: 1400, monedaPorDefecto: 'USD' }, official);

    expect(await suggest('USD')).toEqual({ rate: 1400, source: 'config' });
    expect(official).not.toHaveBeenCalled();
  });

  it('sin moneda en la config, la de la config vale para cualquier extranjera', async () => {
    expect(await exchangeRateSuggestionLoader({ cotizacionPorDefecto: 1400 }, official)('EUR')).toEqual({
      rate: 1400,
      source: 'config',
    });
  });

  it('si no aplica, la oficial; si la consulta falla, ninguna', async () => {
    const suggest = exchangeRateSuggestionLoader({ cotizacionPorDefecto: 1400, monedaPorDefecto: 'USD' }, official);

    expect(await suggest('EUR')).toEqual({ rate: 1450, source: 'arca' });
    expect(official).toHaveBeenCalledWith({ currencyCode: 'EUR' });
    expect(await exchangeRateSuggestionLoader({}, async () => undefined)('USD')).toBeUndefined();
  });
});
