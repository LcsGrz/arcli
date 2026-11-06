import type { Arca } from '@arcasdk/core';
import { describe, expect, it, vi } from 'vitest';

import { ArcaFceObligationGateway } from '../arca-fce-obligation.gateway';

function createGateway(consultarMontoObligadoRecepcion: (...args: unknown[]) => unknown): ArcaFceObligationGateway {
  return new ArcaFceObligationGateway({ wsfecredService: { consultarMontoObligadoRecepcion } } as unknown as Arca);
}

describe('ArcaFceObligationGateway', () => {
  it('consulta con la fecha en ISO y mapea obligado y monto', async () => {
    const consult = vi.fn(async () => ({
      consultarMontoObligadoRecepcionReturn: { montoDesde: '3958316', obligado: 'S' },
    }));

    expect(await createGateway(consult).getObligation(30546689979, '20261105')).toEqual({
      minimumAmount: 3958316,
      obligated: true,
    });
    expect(consult).toHaveBeenCalledWith({ cuitConsultada: 30546689979, fechaEmision: '2026-11-05' });
  });

  it('no obligado y sin monto', async () => {
    const gateway = createGateway(async () => ({ consultarMontoObligadoRecepcionReturn: { obligado: 'N' } }));

    expect(await gateway.getObligation(20111111112, '20261105')).toEqual({ minimumAmount: 0, obligated: false });
  });

  it('los errores de ARCA son FCE_OBLIGATION_ERROR', async () => {
    const gateway = createGateway(async () => ({
      consultarMontoObligadoRecepcionReturn: {
        arrayErrores: { codigoDescripcion: [{ codigo: 1001, descripcion: 'CUIT inválido' }] },
      },
    }));

    await expect(gateway.getObligation(1, '20261105')).rejects.toMatchObject({
      code: 'FCE_OBLIGATION_ERROR',
      message: expect.stringContaining('1001 CUIT inválido'),
    });
  });

  it('un certificado sin wsfecred es FCE_SERVICE_NOT_AUTHORIZED', async () => {
    const gateway = createGateway(async () => {
      throw new Error('ns1:coe.notAuthorized');
    });

    await expect(gateway.getObligation(1, '20261105')).rejects.toMatchObject({ code: 'FCE_SERVICE_NOT_AUTHORIZED' });
  });

  it('otro error sale tal cual', async () => {
    const gateway = createGateway(async () => {
      throw new Error('socket hang up');
    });

    await expect(gateway.getObligation(1, '20261105')).rejects.toThrow('socket hang up');
  });
});
