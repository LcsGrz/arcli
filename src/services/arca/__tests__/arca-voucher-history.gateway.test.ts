import type { Arca } from '@arcasdk/core';
import { describe, expect, it, vi } from 'vitest';

import { ARCA_QUERY_ERROR_SUGGESTION } from '../../../lib/errors/query-error';
import { DEPRECATED_DETAILS_ERROR_KEYS } from '../../../lib/json/deprecations';
import { ArcaVoucherHistoryGateway } from '../arca-voucher-history.gateway';

function createGateway(
  service: Record<string, unknown>,
  generic: Record<string, unknown> = {},
): ArcaVoucherHistoryGateway {
  return new ArcaVoucherHistoryGateway({
    electronicBillingService: service,
    genericService: generic,
  } as unknown as Arca);
}

describe('ArcaVoucherHistoryGateway', () => {
  it('devuelve el último número autorizado', async () => {
    const getLastVoucher = vi.fn(async () => ({ cbteNro: 42 }));

    expect(await createGateway({ getLastVoucher }).getLastNumber(3, 11)).toBe(42);
    expect(getLastVoucher).toHaveBeenCalledWith(3, 11);
  });

  it('corta si ARCA informa errores al pedir el último número', async () => {
    const gateway = createGateway({
      getLastVoucher: vi.fn(async () => ({ errors: { err: [{ code: 11002, msg: 'Punto de venta no habilitado' }] } })),
    });

    await expect(gateway.getLastNumber(3, 11)).rejects.toMatchObject({ code: 'ARCA_LAST_VOUCHER_ERROR' });
  });

  function consulting(resultGet: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}) {
    const call = vi.fn(async () => ({
      FECompConsultarResult: { ...(resultGet ? { ResultGet: resultGet } : {}), ...extra },
    }));

    return { call, gateway: createGateway({}, { call }) };
  }

  it('consulta FECompConsultar con genericService, mapea el comprobante y completa con 0 lo que ARCA no informa', async () => {
    const { call, gateway } = consulting({
      CbteFch: '20261105',
      CodAutorizacion: '75123456789012',
      Concepto: 2,
      DocNro: 20111111112,
      DocTipo: 80,
      FchVto: '20261115',
      ImpIVA: 210,
      ImpNeto: 1000,
      ImpTotal: 1210,
      MonCotiz: 1,
      MonId: 'PES',
      Resultado: 'A',
    });

    expect(await gateway.getVoucher(14, 3, 1)).toEqual({
      associatedVouchers: [],
      cae: '75123456789012',
      caeExpiration: '20261115',
      concept: 2,
      currency: 'PES',
      date: '20261105',
      documentNumber: 20111111112,
      documentTypeCode: 80,
      exchangeRate: 1,
      exemptAmount: 0,
      ivaAliquots: [],
      ivaAmount: 210,
      netAmount: 1000,
      number: 14,
      observations: [],
      optionals: [],
      result: 'A',
      taxes: [],
      taxesAmount: 0,
      total: 1210,
      untaxedAmount: 0,
    });
    expect(call).toHaveBeenCalledWith('wsfe', 'FECompConsultar', {
      FeCompConsReq: { CbteNro: 14, CbteTipo: 1, PtoVta: 3 },
    });
  });

  it('trae lo que getVoucherInfo del SDK descarta (SDK-13)', async () => {
    const { gateway } = consulting({
      CanMisMonExt: 'S',
      CbteFch: '20261105',
      CbtesAsoc: { CbteAsoc: [{ CbteFch: '20261101', Cuit: '20111111112', Nro: 7, PtoVta: 3, Tipo: 201 }] },
      CondicionIVAReceptorId: 1,
      FchServDesde: '20261001',
      FchServHasta: '20261031',
      FchVtoPago: '20261120',
      ImpTotal: 1245,
      Iva: { AlicIva: [{ BaseImp: 1000, Id: 5, Importe: 210 }] },
      MonId: 'DOL',
      Observaciones: {
        Obs: [{ Code: 10217, Msg: 'El credito fiscal discriminado sera de uso exclusivo del receptor.' }],
      },
      Opcionales: { Opcional: [{ Id: '22', Valor: 'N' }] },
      PeriodoAsoc: { FchDesde: '20261001', FchHasta: '20261031' },
      Tributos: { Tributo: [{ Alic: 3.5, BaseImp: 1000, Desc: 'IIBB', Id: 2, Importe: 35 }] },
    });

    expect(await gateway.getVoucher(8, 3, 203)).toMatchObject({
      associatedPeriod: { from: '20261001', to: '20261031' },
      associatedVouchers: [{ arcaType: 201, cuit: '20111111112', date: '20261101', number: 7, pointOfSale: 3 }],
      ivaAliquots: [{ amount: 210, base: 1000, id: 5 }],
      observations: ['El credito fiscal discriminado sera de uso exclusivo del receptor.'],
      optionals: [{ id: '22', value: 'N' }],
      paymentDueDate: '20261120',
      receiverIvaConditionCode: 1,
      sameCurrency: true,
      serviceFrom: '20261001',
      serviceTo: '20261031',
      taxes: [{ amount: 35, base: 1000, description: 'IIBB', id: 2, rate: 3.5 }],
    });
  });

  it('acepta un solo elemento donde el WSDL promete un array, y números como texto', async () => {
    const { gateway } = consulting({
      CanMisMonExt: 'N',
      CbteFch: '20261105',
      CbtesAsoc: { CbteAsoc: { Cuit: 20111111112, Nro: '7', PtoVta: '3', Tipo: '1' } },
      ImpTotal: '121',
      Opcionales: { Opcional: { Id: 2101, Valor: '0110599520000012345678' } },
    });

    expect(await gateway.getVoucher(8, 3, 3)).toMatchObject({
      associatedVouchers: [{ arcaType: 1, cuit: '20111111112', number: 7, pointOfSale: 3 }],
      optionals: [{ id: '2101', value: '0110599520000012345678' }],
      sameCurrency: false,
      total: 121,
    });
  });

  it('sin documento informado es consumidor final', async () => {
    const { gateway } = consulting({ CbteFch: '20261105' });

    expect(await gateway.getVoucher(1, 3, 11)).toMatchObject({ documentNumber: 0, documentTypeCode: 99, total: 0 });
  });

  it('un comprobante que no existe es undefined', async () => {
    const { gateway } = consulting(undefined, {
      Errors: { Err: [{ Code: 602, Msg: 'No existen datos en nuestros registros para los parametros ingresados.' }] },
    });

    expect(await gateway.getVoucher(999, 3, 11)).toBeUndefined();
  });

  const NOT_FOUND = { Code: 602, Msg: 'No existen datos en nuestros registros para los parametros ingresados.' };
  const INVALID_TOKEN = { Code: 600, Msg: 'ValidacionDeToken: No aparecio CUIT.' };

  it.each([
    ['un objeto en lugar de un array', { Err: NOT_FOUND }],
    ['el código como texto', { Err: [{ ...NOT_FOUND, Code: '602' }] }],
    ['dos veces', { Err: [NOT_FOUND, NOT_FOUND] }],
  ])('el 602 es inexistente: %s', async (_case, Errors) => {
    expect(await consulting(undefined, { Errors }).gateway.getVoucher(999, 3, 11)).toBeUndefined();
    // Con un `ResultGet` vacío o en ceros, como hace WSFEX con el 1020, también.
    expect(await consulting({ CbteFch: '', ImpTotal: 0 }, { Errors }).gateway.getVoucher(999, 3, 11)).toBeUndefined();
    for (const CbteFch of ['00000000', '0', '20261340']) {
      expect(await consulting({ CbteFch }, { Errors }).gateway.getVoucher(999, 3, 11)).toBeUndefined();
    }
  });

  it('si ARCA trae el comprobante, un 602 no lo vuelve inexistente', async () => {
    const { gateway } = consulting({ CbteFch: '20261105' }, { Errors: { Err: [NOT_FOUND] } });

    expect(await gateway.getVoucher(14, 3, 11)).toMatchObject({ number: 14 });
  });

  it.each([
    ['array', { Err: [INVALID_TOKEN] }],
    ['objeto', { Err: INVALID_TOKEN }],
    ['código como texto', { Err: { ...INVALID_TOKEN, Code: '600' } }],
  ])('otro error de ARCA no es "no existe" (ERR-1): %s', async (_case, Errors) => {
    const error = await consulting(undefined, { Errors })
      .gateway.getVoucher(999, 3, 11)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 'ARCA_VOUCHER_QUERY_ERROR',
      message:
        'ARCA devolvió un error al consultar el comprobante 00003-00000999 y no se sabe si existe: 600 ValidacionDeToken: No aparecio CUIT.',
      suggestion:
        'Revisá el mensaje de ARCA: si es pasajero, volvé a consultar en unos minutos; si no, corregí lo que dice. Si se repite, no insistas. Si estabas verificando una emisión, no la reintentes hasta saber si el comprobante existe.',
    });
    expect(error).toHaveProperty('details', {
      deprecado: [DEPRECATED_DETAILS_ERROR_KEYS],
      errores: [{ code: 600, codigo: 600, mensaje: INVALID_TOKEN.Msg, msg: INVALID_TOKEN.Msg }],
    });
  });

  it('con un 602 y otro error, gana el otro', async () => {
    for (const Err of [
      [NOT_FOUND, INVALID_TOKEN],
      [INVALID_TOKEN, NOT_FOUND],
    ]) {
      await expect(consulting(undefined, { Errors: { Err } }).gateway.getVoucher(999, 3, 11)).rejects.toMatchObject({
        code: 'ARCA_VOUCHER_QUERY_ERROR',
        details: { errores: Err.map(({ Code }) => ({ codigo: Code })) },
      });
    }
  });

  it.each([
    ['sin código', { Msg: 'No existe' }],
    ['con un código que no es un número', { Code: 'x', Msg: 'No existe' }],
  ])('un error %s conserva el mensaje, no inventa el código y no es "no existe"', async (_case, unreadable) => {
    for (const Err of [unreadable, [unreadable]]) {
      const error = await consulting(undefined, { Errors: { Err } })
        .gateway.getVoucher(999, 3, 11)
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        code: 'ARCA_VOUCHER_QUERY_ERROR',
        details: { errores: [{ codigo: null, mensaje: 'No existe' }] },
        message: 'ARCA devolvió un error al consultar el comprobante 00003-00000999 y no se sabe si existe: No existe',
      });
    }

    await expect(
      consulting(undefined, { Errors: { Err: [NOT_FOUND, unreadable] } }).gateway.getVoucher(999, 3, 11),
    ).rejects.toMatchObject({ code: 'ARCA_VOUCHER_QUERY_ERROR' });
  });

  it.each([[[null]], [[{}]], [{}], ['x'], [[NOT_FOUND, null]]])(
    'un error sin código ni mensaje (%j) es una respuesta inesperada',
    async (Err) => {
      await expect(consulting(undefined, { Errors: { Err } }).gateway.getVoucher(999, 3, 11)).rejects.toMatchObject({
        code: 'ARCA_VOUCHER_QUERY_ERROR',
        message: expect.stringContaining('una respuesta inesperada'),
      });
    },
  );

  it('un código 0 sin mensaje dice lo mismo en el texto y en detalles', async () => {
    await expect(
      consulting(undefined, { Errors: { Err: { Code: 0 } } }).gateway.getVoucher(999, 3, 11),
    ).rejects.toMatchObject({
      details: { errores: [{ codigo: 0, mensaje: '' }] },
      message: 'ARCA devolvió un error al consultar el comprobante 00003-00000999 y no se sabe si existe: 0',
      reason: '0',
    });
  });

  it('un error junto con los datos del comprobante también corta', async () => {
    const { gateway } = consulting({ CbteFch: '20261105' }, { Errors: { Err: [INVALID_TOKEN] } });

    await expect(gateway.getVoucher(14, 3, 11)).rejects.toMatchObject({ code: 'ARCA_VOUCHER_QUERY_ERROR' });
  });

  it.each([
    ['vacía', undefined],
    ['nula', null],
    ['sin resultado', {}],
    ['sin ResultGet ni Errors', { FECompConsultarResult: {} }],
    ['con Errors vacío', { FECompConsultarResult: { Errors: null } }],
    ['sin la fecha del comprobante', { FECompConsultarResult: { ResultGet: { ImpTotal: 100 } } }],
    ['con la fecha en ceros', { FECompConsultarResult: { ResultGet: { CbteFch: '00000000' } } }],
    ['con la fecha 0', { FECompConsultarResult: { ResultGet: { CbteFch: '0' } } }],
    ['con una fecha que no existe', { FECompConsultarResult: { ResultGet: { CbteFch: '20260230' } } }],
  ])('una respuesta inesperada (%s) es un error, no "no existe"', async (_case, response) => {
    const gateway = createGateway({}, { call: vi.fn(async () => response) });

    await expect(gateway.getVoucher(14, 3, 11)).rejects.toMatchObject({
      code: 'ARCA_VOUCHER_QUERY_ERROR',
      details: { errores: [] },
      message:
        'ARCA devolvió una respuesta inesperada al consultar el comprobante 00003-00000014 y no se sabe si existe.',
    });
  });

  // ARQ-22: como en la E, para que una lista lo saltee en lugar de fallar entera.
  it.each<[string, Record<string, unknown>]>([
    ['el número como número', { CbteDesde: 14, CbteHasta: 14 }],
    ['el número como texto y el CAE como número', { CbteDesde: '14', CodAutorizacion: 75123456789012 }],
    ['adentro de un rango', { CbteDesde: 10, CbteHasta: 20 }],
  ])('con su número y su CAE existe, aunque no se pueda leer: %s', async (_case, row) => {
    const { gateway } = consulting({ CbteFch: '20260230', CodAutorizacion: '75123456789012', ...row });

    await expect(gateway.getVoucher(14, 3, 11)).rejects.toMatchObject({
      code: 'ARCA_VOUCHER_QUERY_ERROR',
      details: { errores: [] },
      exists: true,
      message:
        'El comprobante 00003-00000014 existe, con el CAE 75123456789012, pero ARCLI no pudo leer los datos que devolvió ARCA.',
    });
  });

  it.each<[string, Record<string, unknown>]>([
    ['otro número', { CbteDesde: 15, CbteHasta: 15 }],
    ['un rango que no lo incluye', { CbteDesde: 10, CbteHasta: 13 }],
    ['sin número', {}],
    ['sin CAE', { CbteDesde: 14, CodAutorizacion: '' }],
    ['con el CAE en ceros', { CbteDesde: 14, CodAutorizacion: '00000000000000' }],
  ])('no se sabe si existe: %s', async (_case, row) => {
    const { gateway } = consulting({ CodAutorizacion: '75123456789012', ...row });

    await expect(gateway.getVoucher(14, 3, 11)).rejects.toMatchObject({
      exists: false,
      message: expect.stringContaining('no se sabe si existe'),
    });
  });

  it('con un 602 sigue siendo inexistente, y con otro error gana el error', async () => {
    const row = { CbteDesde: 14, CodAutorizacion: '75123456789012' };

    expect(await consulting(row, { Errors: { Err: NOT_FOUND } }).gateway.getVoucher(14, 3, 11)).toBeUndefined();
    await expect(
      consulting(row, { Errors: { Err: INVALID_TOKEN } }).gateway.getVoucher(14, 3, 11),
    ).rejects.toMatchObject({ exists: false, message: expect.stringContaining('600') });
  });

  function failing(error: unknown) {
    return createGateway({}, { call: vi.fn(async () => Promise.reject(error)) });
  }

  it('un 602 que se lanza también es undefined', async () => {
    expect(await failing(Object.assign(new Error('x'), { code: 602 })).getVoucher(999, 3, 11)).toBeUndefined();
    expect(await failing(Object.assign(new Error('x'), { code: '602' })).getVoucher(999, 3, 11)).toBeUndefined();
  });

  it('una excepción con "no existe" en el texto no es un comprobante inexistente', async () => {
    const error = new Error('El dominio no existe');

    await expect(failing(error).getVoucher(999, 3, 11)).rejects.toBe(error);
  });

  it('la red y los transitorios siguen tal cual; no autorizado, con su código', async () => {
    for (const error of [new Error('connect ETIMEDOUT'), new Error('ns1:coe.alreadyAuthenticated')]) {
      await expect(failing(error).getVoucher(1, 3, 11)).rejects.toBe(error);
    }

    await expect(failing(new Error('ns1:cms.cert.notAuthorized')).getVoucher(1, 3, 11)).rejects.toMatchObject({
      code: 'WSFE_SERVICE_NOT_AUTHORIZED',
    });
  });
});

/** ARQ-24: al consultar, sin el último número no se puede decir "No hay": con eso se verifica una emisión. */
describe('ArcaVoucherHistoryGateway.getLastNumber: ARCA contesta sin el último número (ARQ-24)', () => {
  // Tests primero (ARQ-24): pasa a it() al implementarlo.
  it.fails.each<[string, Record<string, unknown>]>([
    ['sin cbteNro', {}],
    ['negativo', { cbteNro: -3 }],
    ['decimal', { cbteNro: 2.5 }],
    ['texto vacío', { cbteNro: '' }],
  ])('%s: ARCA_LAST_VOUCHER_ERROR con la sugerencia de consultar', async (_name, answer) => {
    const gateway = createGateway({ getLastVoucher: vi.fn(async () => answer) });

    const error = await gateway.getLastNumber(3, 11).then(
      (number) => ({ resolved: number }),
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({
      code: 'ARCA_LAST_VOUCHER_ERROR',
      details: { errores: [] },
      message: expect.stringMatching(
        /^ARCA contestó sin el último número de .+ del punto de venta 3 \(sin errores\)\.$/,
      ),
      suggestion: ARCA_QUERY_ERROR_SUGGESTION,
    });
  });

  it('el 0 sigue siendo "no hay comprobantes"', async () => {
    const gateway = createGateway({ getLastVoucher: vi.fn(async () => ({ cbteNro: 0 })) });

    await expect(gateway.getLastNumber(3, 11)).resolves.toBe(0);
  });

  // Tests primero (ARQ-24): pasa a it() al implementarlo.
  it.fails('un número como texto se lee como número', async () => {
    const gateway = createGateway({ getLastVoucher: vi.fn(async () => ({ cbteNro: '42' })) });

    await expect(gateway.getLastNumber(3, 11)).resolves.toBe(42);
  });
});
