import type { Arca } from '@arcasdk/core';
import { describe, expect, it, vi } from 'vitest';

import { ArcaParametersGateway } from '../arca-parameters.gateway';

function createGateway(service: Record<string, unknown>): ArcaParametersGateway {
  return new ArcaParametersGateway({ electronicBillingService: service } as unknown as Arca);
}

describe('ArcaParametersGateway', () => {
  it('el estado de WSFEX sale de FEXDummy', async () => {
    const dummy = vi.fn(async () => ({ FEXDummyResult: { AppServer: 'OK', AuthServer: 'A', DbServer: 'D' } }));
    const gateway = new ArcaParametersGateway({ wsfexService: { dummy } } as unknown as Arca);

    expect(await gateway.getExportServerStatus()).toEqual({ app: 'OK', auth: 'A', db: 'D' });
  });

  it('maps tables and treats "NULL" as no expiry', async () => {
    const gateway = createGateway({
      getIvaReceptorTypes: vi.fn(async () => ({
        resultGet: { condicionIvaReceptor: [{ cmp_Clase: 'A/ALEY/C', desc: 'IVA Responsable Inscripto', id: 1 }] },
      })),
      getVoucherTypes: vi.fn(async () => ({
        resultGet: { cbteTipo: [{ desc: 'Factura A', fchDesde: '20100917', fchHasta: 'NULL', id: 1 }] },
      })),
    });

    expect(await gateway.listTable('comprobantes')).toEqual([
      { description: 'Factura A', detail: undefined, id: '1', validTo: undefined },
    ]);
    expect(await gateway.listTable('iva-receptor')).toEqual([
      { description: 'IVA Responsable Inscripto', detail: 'A/ALEY/C', id: '1', validTo: undefined },
    ]);
  });

  it('returns no sales points on "Sin Resultados" and fails on other errors', async () => {
    const empty = createGateway({
      getSalesPoints: vi.fn(async () => ({
        errors: { err: [{ code: 602, msg: 'Sin Resultados' }] },
        resultGet: { ptoVenta: [] },
      })),
    });
    const failing = createGateway({
      getSalesPoints: vi.fn(async () => ({ errors: { err: [{ code: 600, msg: 'No autorizado' }] } })),
    });

    expect(await empty.getSalesPoints()).toEqual([]);
    await expect(failing.getSalesPoints()).rejects.toMatchObject({ code: 'ARCA_PARAMETERS_ERROR' });
  });

  it('maps sales points', async () => {
    const gateway = createGateway({
      getSalesPoints: vi.fn(async () => ({
        resultGet: {
          ptoVenta: [
            { bloqueado: 'N', emisionTipo: 'CAE - Factura en línea', fechaBaja: 'NULL', nro: 3 },
            { bloqueado: 'S', emisionTipo: 'CAE', nro: 4 },
          ],
        },
      })),
    });

    expect(await gateway.getSalesPoints()).toEqual([
      { blocked: false, closedOn: undefined, emissionType: 'CAE - Factura en línea', number: 3 },
      { blocked: true, closedOn: undefined, emissionType: 'CAE', number: 4 },
    ]);
  });

  it('asks the quotation with the ARCA currency code', async () => {
    const getQuotation = vi.fn(async () => ({ resultGet: { fchCotiz: '20261004', monCotiz: 1167.33, monId: 'DOL' } }));
    const gateway = createGateway({ getQuotation });

    expect(await gateway.getQuotation('usd')).toEqual({ currency: 'DOL', date: '20261004', rate: 1167.33 });
    expect(getQuotation).toHaveBeenCalledWith('DOL');
  });

  it.each([
    ['cero', { resultGet: { fchCotiz: '20261004', monCotiz: 0, monId: 'DOL' } }],
    ['faltante', { resultGet: { fchCotiz: '20261004', monId: 'DOL' } }],
    ['sin resultGet', {}],
  ])('fails with ARCA_QUOTATION_ERROR when the quotation is %s', async (_label, response) => {
    const gateway = createGateway({ getQuotation: vi.fn(async () => response) });

    await expect(gateway.getQuotation('usd')).rejects.toMatchObject({
      code: 'ARCA_QUOTATION_ERROR',
      details: { errores: [] },
      message: 'ARCA no devolvió una cotización para usd.',
    });
  });

  it('keeps the ARCA errors of a missing quotation in detalles.errores', async () => {
    const errors = { err: [{ code: 600, msg: 'Moneda inexistente' }] };
    const gateway = createGateway({ getQuotation: vi.fn(async () => ({ errors })) });

    await expect(gateway.getQuotation('XXX')).rejects.toMatchObject({
      code: 'ARCA_QUOTATION_ERROR',
      details: { errores: [{ codigo: 600, mensaje: 'Moneda inexistente' }], errors },
    });
  });

  it('translates a certificate not authorized for wsfe in every query that logs in (ERR-7)', async () => {
    const rejected = async () => Promise.reject(new Error('ns1:coe.notAuthorized: Computador no autorizado'));
    const gateway = createGateway({
      getAliquotTypes: rejected,
      getConceptTypes: rejected,
      getCurrencyTypes: rejected,
      getDocumentTypes: rejected,
      getIvaReceptorTypes: rejected,
      getOptionalTypes: rejected,
      getQuotation: rejected,
      getSalesPoints: rejected,
      getTaxTypes: rejected,
      getVoucherTypes: rejected,
    });
    const tables = [
      'alicuotas',
      'comprobantes',
      'conceptos',
      'documentos',
      'iva-receptor',
      'monedas',
      'opcionales',
      'tributos',
    ] as const;

    for (const query of [
      () => gateway.getSalesPoints(),
      () => gateway.getQuotation('USD'),
      ...tables.map((table) => () => gateway.listTable(table)),
    ]) {
      await expect(query()).rejects.toMatchObject({ code: 'WSFE_SERVICE_NOT_AUTHORIZED' });
    }
  });

  it('maps the server status', async () => {
    const gateway = createGateway({
      getServerStatus: vi.fn(async () => ({ appServer: 'OK', authServer: 'OK', dbServer: 'ERROR' })),
    });

    expect(await gateway.getServerStatus()).toEqual({ app: 'OK', auth: 'OK', db: 'ERROR' });
  });
});
