import { describe, expect, it, vi } from 'vitest';

import { prepareBillingInput, resolveFceWarningsInOrder } from '../billing.prepare';
import type { BillingCommandInput } from '../billing.schemas';
import { BillingService } from '../billing.service';

function input(overrides: Partial<BillingCommandInput> = {}): BillingCommandInput {
  return {
    cancellation: false,
    concept: 'servicios',
    currencyCode: 'PES',
    documentType: 'consumidor-final',
    dryRun: true,
    emit: false,
    ivaCondition: 'consumidor-final',
    sameCurrency: false,
    shortcut: 'fc',
    totalAmount: 1000,
    ...overrides,
  } as BillingCommandInput;
}

const PADRON = { getTaxpayer: vi.fn(async () => null) };

describe('prepareBillingInput', () => {
  const service = new BillingService();

  it('en pesos no consulta la cotizacion ni avisa nada', async () => {
    const getQuotation = vi.fn(async () => 1000);
    const prepared = await prepareBillingInput(service, input(), { billing: { getQuotation }, padron: PADRON });

    expect(getQuotation).not.toHaveBeenCalled();
    expect(prepared.warnings).toEqual([]);
  });

  it('en moneda extranjera sin --cm usa la oficial y lo avisa', async () => {
    const getQuotation = vi.fn(async () => 1415.25);
    const prepared = await prepareBillingInput(service, input({ currencyCode: 'USD', exchangeRate: undefined }), {
      billing: { getQuotation },
      padron: PADRON,
    });

    expect(getQuotation).toHaveBeenCalledWith('DOL');
    expect(prepared.input).toMatchObject({ exchangeRate: 1415.25, exchangeRateSource: 'arca' });
    expect(prepared.warnings).toEqual([expect.stringContaining('cotización oficial')]);
  });

  it('avisa que --dia esta deprecado', async () => {
    const prepared = await prepareBillingInput(service, input({ dueDay: 10 }), {
      billing: { getQuotation: vi.fn() },
      padron: PADRON,
    });

    expect(prepared.warnings).toEqual([expect.stringContaining('--dia')]);
  });
});

describe('resolveFceWarningsInOrder', () => {
  it('consulta un comprobante por vez, en orden', async () => {
    const service = new BillingService();
    const calls: string[] = [];
    const spy = vi.spyOn(service, 'resolveFceWarnings').mockImplementation(async (entry) => {
      calls.push(`inicio ${entry.totalAmount}`);
      await new Promise((resolve) => setTimeout(resolve, entry.totalAmount === 1 ? 20 : 0));
      calls.push(`fin ${entry.totalAmount}`);

      return [`aviso ${entry.totalAmount}`];
    });

    const warnings = await resolveFceWarningsInOrder(service, [input({ totalAmount: 1 }), input({ totalAmount: 2 })], {
      getObligation: vi.fn(),
    } as never);

    expect(warnings).toEqual([['aviso 1'], ['aviso 2']]);
    expect(calls).toEqual(['inicio 1', 'fin 1', 'inicio 2', 'fin 2']);
    spy.mockRestore();
  });
});
