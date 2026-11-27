import { describe, expect, it, vi } from 'vitest';

import { DEPRECATED_DETAILS_ERROR_KEYS, DEPRECATED_DETAILS_ERRORS } from '../../../lib/json/deprecations';
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

  // ARQ-24: sin `cbteNro` ya no es "no hay comprobantes" (ver el describe de abajo); solo el 0 lo es.
  it('starts at 1 when the sales point has no vouchers yet', async () => {
    const empty = createGateway({ getLastVoucher: vi.fn(async () => ({ cbteNro: 0 })) });

    await expect(empty.getNextVoucherNumber(3, 11)).resolves.toBe(1);
  });

  it('translates a certificate not authorized for wsfe, the usual first error, instead of an unexpected one', async () => {
    const notAuthorized = new Error('ns1:coe.notAuthorized: Computador no autorizado a acceder al servicio');
    const gateway = createGateway({
      getLastVoucher: vi.fn(async () => Promise.reject(notAuthorized)),
      getQuotation: vi.fn(async () => Promise.reject(notAuthorized)),
    });

    // Nunca "No se emitió nada": en un lote puede haber emitidos, y este texto se cita en avisos.
    await expect(gateway.getNextVoucherNumber(3, 11)).rejects.toMatchObject({
      code: 'WSFE_SERVICE_NOT_AUTHORIZED',
      message: 'El certificado no está autorizado para facturar (servicio wsfe).',
    });
    await expect(gateway.getQuotation('DOL')).rejects.toMatchObject({ code: 'WSFE_SERVICE_NOT_AUTHORIZED' });
  });

  it('reads the codes of the WSFEv1 currency table, and fails with ARCA_PARAMETERS_ERROR on an ARCA error', async () => {
    const gateway = createGateway({
      getCurrencyTypes: vi.fn(async () => ({ resultGet: { moneda: [{ desc: 'Dólar', id: 'DOL' }, { id: '060' }] } })),
    });
    const failing = createGateway({
      getCurrencyTypes: vi.fn(async () => ({ errors: { err: [{ code: 600, msg: 'ValidacionDeToken' }] } })),
    });

    await expect(gateway.getCurrencyCodes()).resolves.toEqual(['DOL', '060']);
    await expect(failing.getCurrencyCodes()).rejects.toMatchObject({ code: 'ARCA_PARAMETERS_ERROR' });
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
      details: {
        deprecado: [DEPRECATED_DETAILS_ERRORS, DEPRECATED_DETAILS_ERROR_KEYS],
        errores: [{ codigo: 600, mensaje: 'Moneda inexistente' }],
        errors,
      },
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

/**
 * ARQ-24: el WSDL hace obligatorio `CbteNro`. Si ARCA contesta sin un entero >= 0 no se sabe cuál es el último: pedir
 * el 1 lo rechaza ARCA, y un número inventado puede chocar con uno emitido. Se corta antes de emitir.
 */
describe('ArcaBillingGateway.getNextVoucherNumber: ARCA contesta sin el último número (ARQ-24)', () => {
  const UNREADABLE: ReadonlyArray<[string, Record<string, unknown>]> = [
    ['sin cbteNro', {}],
    ['null', { cbteNro: null }],
    ['negativo', { cbteNro: -1 }],
    ['decimal', { cbteNro: 41.5 }],
    ['NaN', { cbteNro: Number.NaN }],
    ['texto vacío', { cbteNro: '' }],
    ['texto que no es un número', { cbteNro: 'cuarenta' }],
  ];

  // Tests primero (ARQ-24): pasa a it() al implementarlo.
  it.fails.each(UNREADABLE)(
    '%s: ARCA_LAST_VOUCHER_ERROR sin errores de ARCA, antes de emitir',
    async (_name, answer) => {
      const gateway = createGateway({ getLastVoucher: vi.fn(async () => answer) });

      const error = await gateway.getNextVoucherNumber(3, 11).then(
        (number) => ({ resolved: number }),
        (caught: unknown) => caught,
      );

      expect(error).toMatchObject({
        code: 'ARCA_LAST_VOUCHER_ERROR',
        details: { errores: [] },
        message: expect.stringMatching(
          /^ARCA contestó sin el último número de .+ del punto de venta 3 \(sin errores\)\.$/,
        ),
        suggestion: 'No se emitió nada. Revisá el mensaje de ARCA y reintentá.',
      });
    },
  );

  // Tests primero (ARQ-24): pasa a it() al implementarlo.
  it.fails.each<[string, unknown, number]>([
    ['41', '41', 42],
    ['0', '0', 1],
  ])('un número como texto ("%s") se lee como número', async (_name, cbteNro, next) => {
    const gateway = createGateway({ getLastVoucher: vi.fn(async () => ({ cbteNro })) });

    await expect(gateway.getNextVoucherNumber(3, 11)).resolves.toBe(next);
  });
});
