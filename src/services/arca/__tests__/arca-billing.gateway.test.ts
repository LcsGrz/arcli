import { describe, expect, it, vi } from 'vitest';

import { ArcaBillingGateway } from '../arca-billing.gateway';
import type { Arca } from '../arca-sdk.types';

function createGateway(service: Record<string, unknown>): ArcaBillingGateway {
  return new ArcaBillingGateway({ electronicBillingService: service } as unknown as Arca);
}

describe('ArcaBillingGateway', () => {
  it('returns the last authorized number plus one, like createNextVoucher', async () => {
    const getLastVoucher = vi.fn(async () => ({ cbteNro: 41 }));
    const gateway = createGateway({ getLastVoucher });

    await expect(gateway.getNextVoucherNumber(3, 11)).resolves.toBe(42);
    expect(getLastVoucher).toHaveBeenCalledWith(3, 11);
  });

  it('starts at 1 when the sales point has no vouchers yet', async () => {
    const empty = createGateway({ getLastVoucher: vi.fn(async () => ({ cbteNro: 0 })) });
    const missing = createGateway({ getLastVoucher: vi.fn(async () => ({})) });

    await expect(empty.getNextVoucherNumber(3, 11)).resolves.toBe(1);
    await expect(missing.getNextVoucherNumber(3, 11)).resolves.toBe(1);
  });

  it('translates a certificate not authorized for wsfe, the usual first error, instead of an unexpected one', async () => {
    const notAuthorized = new Error('ns1:coe.notAuthorized: Computador no autorizado a acceder al servicio');
    const gateway = createGateway({
      getLastVoucher: vi.fn(async () => Promise.reject(notAuthorized)),
      getQuotation: vi.fn(async () => Promise.reject(notAuthorized)),
    });

    await expect(gateway.getNextVoucherNumber(3, 11)).rejects.toMatchObject({ code: 'WSFE_SERVICE_NOT_AUTHORIZED' });
    await expect(gateway.getQuotation('DOL')).rejects.toMatchObject({ code: 'WSFE_SERVICE_NOT_AUTHORIZED' });
  });

  it('fails before emitting when the numbering is exhausted', async () => {
    const gateway = createGateway({ getLastVoucher: vi.fn(async () => ({ cbteNro: 99_999_999 })) });

    await expect(gateway.getNextVoucherNumber(3, 11)).rejects.toThrow(/no puede ser mayor a 99999999/);
  });

  it('fails before emitting when ARCA returns errors for the last number', async () => {
    const gateway = createGateway({
      getLastVoucher: vi.fn(async () => ({
        errors: {
          err: [{ code: 11002, msg: 'El punto de venta no se encuentra habilitado a usar en el presente WS' }],
        },
      })),
    });

    const error = await gateway.getNextVoucherNumber(9, 11).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 'ARCA_LAST_VOUCHER_ERROR',
      details: { errores: [{ code: 11002 }] },
      suggestion: expect.stringMatching(/parametros puntos-venta/),
    });
    expect((error as Error).message).toMatch(/punto de venta 9: 11002/);
  });

  it('suggests retrying when the last-number error is not about the sales point', async () => {
    const gateway = createGateway({
      getLastVoucher: vi.fn(async () => ({ errors: { err: [{ code: 600, msg: 'ValidacionDeToken' }] } })),
    });

    await expect(gateway.getNextVoucherNumber(3, 11)).rejects.toMatchObject({
      code: 'ARCA_LAST_VOUCHER_ERROR',
      suggestion: expect.stringMatching(/No se emitió nada/),
    });
  });

  it('propagates authentication and last-number failures as they are', async () => {
    const wsaaError = new Error('Certificado expirado');
    const gateway = createGateway({
      getLastVoucher: vi.fn(async () => {
        throw wsaaError;
      }),
    });

    await expect(gateway.getNextVoucherNumber(3, 11)).rejects.toBe(wsaaError);
  });

  it.each([
    ['zero', { resultGet: { monCotiz: 0 } }],
    ['negative', { resultGet: { monCotiz: -1 } }],
    ['missing', { resultGet: {} }],
  ])('fails with ARCA_QUOTATION_ERROR when the quotation is %s', async (_label, response) => {
    const gateway = createGateway({ getQuotation: vi.fn(async () => response) });

    await expect(gateway.getQuotation('DOL')).rejects.toMatchObject({
      code: 'ARCA_QUOTATION_ERROR',
      details: { errores: [] },
      message: 'ARCA no devolvió una cotización válida para DOL.',
    });
  });

  it('keeps the ARCA errors of a failed quotation in detalles.errores, and the deprecated errors key', async () => {
    const errors = { err: [{ code: 600, msg: 'Moneda inexistente' }] };
    const gateway = createGateway({ getQuotation: vi.fn(async () => ({ errors })) });

    await expect(gateway.getQuotation('XXX')).rejects.toMatchObject({
      code: 'ARCA_QUOTATION_ERROR',
      details: { deprecado: [expect.any(String)], errores: [{ codigo: 600, mensaje: 'Moneda inexistente' }], errors },
    });
  });

  describe('with a date (FchCotiz, which the SDK does not send)', () => {
    function createDatedGateway(call: ReturnType<typeof vi.fn>): ArcaBillingGateway {
      return new ArcaBillingGateway({ genericService: { call } } as unknown as Arca);
    }

    const found = (rate: number, date: string) => ({
      FEParamGetCotizacionResult: { ResultGet: { FchCotiz: date, MonCotiz: rate, MonId: 'DOL' } },
    });
    const noResults = { FEParamGetCotizacionResult: { Errors: { Err: { Code: 602, Msg: 'Sin Resultados' } } } };

    it('calls FEParamGetCotizacion with FchCotiz through the generic service', async () => {
      const call = vi.fn(async () => found(1179.909, '20261115'));

      await expect(createDatedGateway(call).getQuotation('DOL', '20261115')).resolves.toBe(1179.909);
      expect(call).toHaveBeenCalledWith('wsfe', 'FEParamGetCotizacion', { FchCotiz: '20261115', MonId: 'DOL' });
    });

    it('goes back one day at a time while ARCA has no rate for that day (602: a weekend or a holiday)', async () => {
      const call = vi
        .fn()
        .mockResolvedValueOnce(noResults)
        .mockResolvedValueOnce(noResults)
        .mockResolvedValueOnce(found(1179.27, '20261113'));

      await expect(createDatedGateway(call).getQuotation('DOL', '20261115')).resolves.toBe(1179.27);
      expect(call.mock.calls.map((args) => (args[2] as { FchCotiz: string }).FchCotiz)).toEqual([
        '20261115',
        '20261114',
        '20261113',
      ]);
    });

    it('stops at another ARCA error and after a week without rates', async () => {
      const invalid = {
        FEParamGetCotizacionResult: { Errors: { Err: [{ Code: 12002, Msg: 'FchCotiz no es una fecha valida' }] } },
      };
      const failing = vi.fn(async () => invalid);
      const empty = vi.fn(async () => noResults);

      await expect(createDatedGateway(failing).getQuotation('DOL', '20261115')).rejects.toMatchObject({
        code: 'ARCA_QUOTATION_ERROR',
        details: { errores: [{ codigo: 12002 }] },
      });
      expect(failing).toHaveBeenCalledTimes(1);
      await expect(createDatedGateway(empty).getQuotation('DOL', '20261115')).rejects.toMatchObject({
        code: 'ARCA_QUOTATION_ERROR',
        message: 'ARCA no devolvió una cotización válida para DOL al 15/11/2026.',
      });
      expect(empty).toHaveBeenCalledTimes(7);
    });
  });
});
