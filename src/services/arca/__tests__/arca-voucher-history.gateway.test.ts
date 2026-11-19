import type { Arca } from '@arcasdk/core';
import { describe, expect, it, vi } from 'vitest';

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

  it('un error "no existe" que se lanza también es undefined; otro error sigue', async () => {
    const notFound = createGateway(
      {},
      { call: vi.fn(async () => Promise.reject(Object.assign(new Error('x'), { code: 602 }))) },
    );

    expect(await notFound.getVoucher(999, 3, 11)).toBeUndefined();

    const notAuthorized = createGateway(
      {},
      { call: vi.fn(async () => Promise.reject(new Error('ns1:cms.cert.notAuthorized'))) },
    );

    await expect(notAuthorized.getVoucher(1, 3, 11)).rejects.toMatchObject({ code: 'WSFE_SERVICE_NOT_AUTHORIZED' });
  });
});
