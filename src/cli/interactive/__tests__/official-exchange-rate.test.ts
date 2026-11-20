import { describe, expect, it, vi } from 'vitest';

import { BillingService } from '../../../modules/billing/billing.service';
import { officialExchangeRateLoader } from '../official-exchange-rate';

vi.mock('../../spinner', () => ({ startSpinner: () => undefined }));

describe('officialExchangeRateLoader', () => {
  it('consulta la oficial de ARCA como el CLI sin --cm, una vez por moneda', async () => {
    const getQuotation = vi.fn(async (currencyCode: string) => (currencyCode === 'DOL' ? 1450 : 1600));
    const load = officialExchangeRateLoader({
      billingGateway: { getQuotation } as never,
      service: new BillingService(),
    });

    expect(await load('USD')).toBe(1450);
    expect(await load('USD')).toBe(1450);
    expect(await load('EUR')).toBe(1600);
    expect(getQuotation.mock.calls).toEqual([['DOL'], ['060']]);
  });

  it('si la consulta falla, no hay oficial (la pregunta arranca vacía) y no la vuelve a intentar', async () => {
    const getQuotation = vi.fn(async () => {
      throw new Error('Sin conexión');
    });
    const load = officialExchangeRateLoader({
      billingGateway: { getQuotation } as never,
      service: new BillingService(),
    });

    expect(await load('USD')).toBeUndefined();
    expect(await load('USD')).toBeUndefined();
    expect(getQuotation).toHaveBeenCalledTimes(1);
  });
});
