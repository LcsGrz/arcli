import { describe, expect, it, vi } from 'vitest';

import { systemClock } from '../../../services/time/system-clock';
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
  const service = new BillingService({ clock: systemClock });

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

  describe('moneda que no esta en la tabla de WSFEv1 (10037)', () => {
    it('es error de entrada antes de pedir la cotizacion, con o sin --cm', async () => {
      const getQuotation = vi.fn(async () => 1000);
      const getCurrencyCodes = vi.fn(async () => ['PES', 'DOL', '060']);

      for (const exchangeRate of [undefined, 1000]) {
        await expect(
          prepareBillingInput(service, input({ currencyCode: 'xyz', exchangeRate }), {
            billing: { getCurrencyCodes, getQuotation },
            padron: PADRON,
          }),
        ).rejects.toMatchObject({
          code: 'INPUT_VALIDATION_ERROR',
          message: 'La moneda XYZ no está en la tabla de monedas de ARCA: la rechaza al emitir (error 10037).',
          suggestion: expect.stringMatching(/`--moneda`.*`arcli parametros monedas`/),
        });
      }

      expect(getQuotation).not.toHaveBeenCalled();
    });

    it('una que ARCA suma a su tabla pasa, y las que ARCLI conoce no consultan la tabla', async () => {
      const getCurrencyCodes = vi.fn(async () => ['PES', 'DOL', 'NUE']);
      const billing = { getCurrencyCodes, getQuotation: vi.fn(async () => 10) };

      await expect(
        prepareBillingInput(service, input({ currencyCode: 'NUE', exchangeRate: undefined }), {
          billing,
          padron: PADRON,
        }),
      ).resolves.toMatchObject({ input: { exchangeRate: 10 } });
      expect(getCurrencyCodes).toHaveBeenCalledTimes(1);

      await prepareBillingInput(service, input({ currencyCode: 'EUR', exchangeRate: undefined }), {
        billing,
        padron: PADRON,
      });
      expect(getCurrencyCodes).toHaveBeenCalledTimes(1);
    });

    it('si la tabla no se puede leer, sigue y decide ARCA', async () => {
      const billing = {
        getCurrencyCodes: vi.fn(async () => Promise.reject(new Error('ARCA no responde'))),
        getQuotation: vi.fn(async () => 10),
      };

      await expect(
        prepareBillingInput(service, input({ currencyCode: 'XYZ', exchangeRate: undefined }), {
          billing,
          padron: PADRON,
        }),
      ).resolves.toMatchObject({ input: { exchangeRate: 10 } });
    });
  });

  describe('cotizacion fuera del rango de la 10119 (2 % a 500 % de la oficial)', () => {
    const gateways = (official: number) => ({
      billing: { getQuotation: vi.fn(async () => official) },
      padron: PADRON,
    });

    it('con --cm dentro del rango compara con la oficial y sigue sin avisos', async () => {
      const used = gateways(1000);
      const prepared = await prepareBillingInput(service, input({ currencyCode: 'USD', exchangeRate: 5000 }), used);

      expect(used.billing.getQuotation).toHaveBeenCalledWith('DOL');
      expect(prepared.warnings).toEqual([]);
    });

    it('frena una cotizacion por encima del 500 % o por debajo del 2 %, nombrando el dato', async () => {
      await expect(
        prepareBillingInput(service, input({ currencyCode: 'USD', exchangeRate: 5000.01 }), gateways(1000)),
      ).rejects.toMatchObject({
        code: 'INPUT_VALIDATION_ERROR',
        message:
          'La cotización de USD (5.000,01) está fuera de lo que acepta ARCA: entre el 2 % y el 500 % de la oficial (1.000), o sea de 20 a 5.000.',
        suggestion: 'Revisá `--cm`, o sacala para usar la oficial de ARCA.',
      });
      await expect(
        prepareBillingInput(
          service,
          input({ currencyCode: 'USD', exchangeRate: 19.99, fromFile: ['exchangeRate'] }),
          gateways(1000),
        ),
      ).rejects.toMatchObject({
        suggestion: 'Revisá `"cotizacionMoneda"` del JSON de `--cargar`, o sacala para usar la oficial de ARCA.',
      });
      await expect(
        prepareBillingInput(
          service,
          input({ currencyCode: 'USD', exchangeRate: 6000, exchangeRateSource: 'config' }),
          gateways(1000),
        ),
      ).rejects.toMatchObject({ suggestion: expect.stringContaining('la clave `cotizacion` de la config') });
    });

    it('no compara la oficial ni la de --misma-moneda, y deja la cotizacion 1 a su propio error', async () => {
      for (const entry of [
        input({ currencyCode: 'USD', exchangeRate: undefined }),
        input({ currencyCode: 'USD', exchangeRate: undefined, sameCurrency: true }),
        input({ currencyCode: 'USD', exchangeRate: 1 }),
      ]) {
        await expect(prepareBillingInput(service, entry, gateways(1000))).resolves.toBeDefined();
      }
    });

    it('si la consulta falla, avisa y sigue', async () => {
      const prepared = await prepareBillingInput(service, input({ currencyCode: 'USD', exchangeRate: 5000 }), {
        billing: { getQuotation: vi.fn(async () => Promise.reject(new Error('ARCA no responde.'))) },
        padron: PADRON,
      });

      expect(prepared.warnings).toEqual([
        'No se pudo comparar la cotización con la oficial de ARCA: ARCA no responde. ARCA la rechaza si no está entre el 2 % y el 500 % de la oficial (error 10119).',
      ]);
    });
  });

  it('avisa que --dia esta deprecado', async () => {
    const prepared = await prepareBillingInput(service, input({ dueDay: 10 }), {
      billing: { getQuotation: vi.fn() },
      padron: PADRON,
    });

    expect(prepared.warnings).toEqual([expect.stringContaining('--dia')]);
  });

  it('si "dia" vino del JSON de --cargar, el aviso nombra la clave y no el flag', async () => {
    const prepared = await prepareBillingInput(service, input({ dueDay: 10, fromFile: ['dueDay'] }), {
      billing: { getQuotation: vi.fn() },
      padron: PADRON,
    });

    expect(prepared.warnings).toEqual([
      'La clave "dia" del JSON de `--cargar` está deprecada y se va a sacar en una próxima versión: usá "vencimientoPago" (por ejemplo, `"vencimientoPago": "10"`).',
    ]);
  });
});

describe('resolveFceWarningsInOrder', () => {
  it('consulta un comprobante por vez, en orden', async () => {
    const service = new BillingService({ clock: systemClock });
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
