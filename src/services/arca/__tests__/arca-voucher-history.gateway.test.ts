import type { Arca } from '@arcasdk/core';
import { describe, expect, it, vi } from 'vitest';

import { ArcaVoucherHistoryGateway } from '../arca-voucher-history.gateway';

function createGateway(service: Record<string, unknown>): ArcaVoucherHistoryGateway {
  return new ArcaVoucherHistoryGateway({ electronicBillingService: service } as unknown as Arca);
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

  it('mapea el comprobante y completa con 0 lo que ARCA no informa', async () => {
    const getVoucherInfo = vi.fn(async () => ({
      cbteFch: '20261105',
      codAutorizacion: '75123456789012',
      concepto: 2,
      docNro: 20111111112,
      docTipo: 80,
      fchVto: '20261115',
      impIVA: 210,
      impNeto: 1000,
      impTotal: 1210,
      monCotiz: 1,
      monId: 'PES',
      resultado: 'A',
    }));

    expect(await createGateway({ getVoucherInfo }).getVoucher(14, 3, 1)).toEqual({
      cae: '75123456789012',
      caeExpiration: '20261115',
      concept: 2,
      currency: 'PES',
      date: '20261105',
      documentNumber: 20111111112,
      documentTypeCode: 80,
      exchangeRate: 1,
      exemptAmount: 0,
      ivaAmount: 210,
      netAmount: 1000,
      number: 14,
      result: 'A',
      taxesAmount: 0,
      total: 1210,
      untaxedAmount: 0,
    });
    expect(getVoucherInfo).toHaveBeenCalledWith(14, 3, 1);
  });

  it('sin documento informado es consumidor final', async () => {
    const gateway = createGateway({ getVoucherInfo: vi.fn(async () => ({ cbteFch: '20261105' })) });

    expect(await gateway.getVoucher(1, 3, 11)).toMatchObject({ documentNumber: 0, documentTypeCode: 99, total: 0 });
  });

  it('un comprobante que no existe es undefined', async () => {
    const gateway = createGateway({ getVoucherInfo: vi.fn(async () => null) });

    expect(await gateway.getVoucher(999, 3, 11)).toBeUndefined();
  });
});
