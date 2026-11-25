import type { Arca } from '@arcasdk/core';
import { describe, expect, it, vi } from 'vitest';

import { ArcaFceRegistryGateway } from '../arca-fce-registry.gateway';

const ID = { arcaType: 202, cuit: 20409509763, number: 1, pointOfSale: 3 };

function createGateway(consultarHistorialEstadosComprobante: (...args: unknown[]) => unknown): ArcaFceRegistryGateway {
  return new ArcaFceRegistryGateway({ wsfecredService: { consultarHistorialEstadosComprobante } } as unknown as Arca);
}

const history = (estadoHistorico: unknown) => async () => ({
  consultarHistorialEstadosComprobanteReturn: { arrayHistorialEstados: { estadoHistorico } },
});

describe('ArcaFceRegistryGateway', () => {
  it('el estado actual es el más reciente, aunque wsfecred no los ordene (como respondió testing)', async () => {
    const consult = vi.fn(
      history([
        { estado: 'Recepcionado', fechaHoraEstado: '2026-11-17T20:00:00.000Z' },
        { estado: 'PendienteRecepcion', fechaHoraEstado: '2026-11-17T18:49:57.000Z' },
      ]),
    );

    expect(await createGateway(consult).getVoucherState(ID)).toBe('Recepcionado');
    expect(consult).toHaveBeenCalledWith({
      idComprobante: { CUITEmisor: 20409509763, codTipoCmp: 202, nroCmp: 1, ptoVta: 3 },
    });
  });

  it('un solo estado puede venir sin array', async () => {
    const gateway = createGateway(history({ estado: 'Rechazado', fechaHoraEstado: '2026-11-17T20:00:00.000Z' }));

    expect(await gateway.getVoucherState(ID)).toBe('Rechazado');
  });

  it('1105 (no existe el comprobante) es undefined', async () => {
    const gateway = createGateway(async () => ({
      consultarHistorialEstadosComprobanteReturn: {
        arrayErrores: { codigoDescripcion: [{ codigo: 1105, descripcion: 'No existe el comprobante indicado' }] },
      },
    }));

    expect(await gateway.getVoucherState(ID)).toBeUndefined();
  });

  it('otros errores de ARCA salen con su código y descripción', async () => {
    const gateway = createGateway(async () => ({
      consultarHistorialEstadosComprobanteReturn: {
        arrayErrores: { codigoDescripcion: { codigo: 1001, descripcion: 'CUIT inválido' } },
      },
    }));

    await expect(gateway.getVoucherState(ID)).rejects.toThrow('1001 CUIT inválido');
  });

  it('un certificado sin wsfecred es FCE_SERVICE_NOT_AUTHORIZED', async () => {
    const gateway = createGateway(async () => {
      throw new Error('ns1:coe.notAuthorized');
    });

    // El texto se cita en un aviso: cómo autorizarlo va en el mensaje, no en la sugerencia.
    await expect(gateway.getVoucherState(ID)).rejects.toMatchObject({
      code: 'FCE_SERVICE_NOT_AUTHORIZED',
      message:
        'El certificado no está autorizado para el servicio wsfecred (Factura de Crédito Electrónica). Autorizalo igual que wsfe: en testing desde WSASS ("Crear autorización a servicio") y en producción desde el Administrador de Relaciones.',
      suggestion: undefined,
    });
  });
});
