import type { Arca } from '@arcasdk/core';
import { describe, expect, it, vi } from 'vitest';

import { ArcaExportGateway } from '../arca-export.gateway';

const EMPTY_RESULT = { FEXErr: { ErrCode: 0, ErrMsg: '' }, FEXEvents: { EventCode: 0, EventMsg: '' } };

function createGateway(service: Record<string, unknown>): ArcaExportGateway {
  return new ArcaExportGateway({ wsfexService: service } as unknown as Arca);
}

describe('ArcaExportGateway', () => {
  it('mapea los paises de destino, ignorando codigos invalidos', async () => {
    const gateway = createGateway({
      getParamDstPais: vi.fn(async () => ({
        FEXGetPARAM_DST_paisResult: {
          ...EMPTY_RESULT,
          FEXResultGet: {
            ClsFEXResponse_DST_pais: [
              { DST_Codigo: '203', DST_Ds: 'Brasil' },
              { DST_Codigo: 'sin codigo', DST_Ds: 'Narnia' },
              { DST_Codigo: '212', DST_Ds: ' Chile ' },
            ],
          },
        },
      })),
    });

    await expect(gateway.getDestinationCountries()).resolves.toEqual([
      { code: 203, name: 'Brasil' },
      { code: 212, name: 'Chile' },
    ]);
  });

  it('acepta un solo elemento donde el WSDL promete un array', async () => {
    const gateway = createGateway({
      getParamUMed: vi.fn(async () => ({
        FEXGetPARAM_UMedResult: {
          ...EMPTY_RESULT,
          FEXResultGet: { ClsFEXResponse_UMed: { Umed_Id: 7, Umed_Ds: 'Unidad' } },
        },
      })),
    });

    await expect(gateway.getUnits()).resolves.toEqual([{ id: 7, name: 'Unidad' }]);
  });

  it('mapea incoterms, idiomas y CUIT de paises', async () => {
    const gateway = createGateway({
      getParamDstCuit: vi.fn(async () => ({
        FEXGetPARAM_DST_CUITResult: {
          ...EMPTY_RESULT,
          FEXResultGet: { ClsFEXResponse_DST_cuit: [{ DST_CUIT: 50000000016, DST_Ds: 'Brasil' }] },
        },
      })),
      getParamIdiomas: vi.fn(async () => ({
        FEXGetPARAM_IdiomasResult: {
          ...EMPTY_RESULT,
          FEXResultGet: { ClsFEXResponse_Idi: [{ Idi_Id: 1, Idi_Ds: 'Espanol' }] },
        },
      })),
      getParamIncoterms: vi.fn(async () => ({
        FEXGetPARAM_IncotermsResult: {
          ...EMPTY_RESULT,
          FEXResultGet: { ClsFEXResponse_Inc: [{ Inc_Id: 'FOB', Inc_Ds: 'Free on Board' }] },
        },
      })),
    });

    await expect(gateway.getDestinationCountryCuits()).resolves.toEqual([{ countryName: 'Brasil', cuit: 50000000016 }]);
    await expect(gateway.getLanguages()).resolves.toEqual([{ id: 1, name: 'Espanol' }]);
    await expect(gateway.getIncoterms()).resolves.toEqual([{ code: 'FOB', name: 'Free on Board' }]);
  });

  it('mapea la tabla de actividades de WSFEX, que trae los codigos en Desc', async () => {
    const gateway = createGateway({
      getParamActividades: vi.fn(async () => ({
        FEXGetPARAM_ActividadesResult: {
          ...EMPTY_RESULT,
          FEXResultGet: {
            ClsFEXResponse_ActividadTipo: [
              { Desc: 'SERVICIOS DE CONSULTORES EN INFORMATICA', Id: 620100, Orden: 123 },
              { Desc: 'SIN CODIGO', Id: 'x', Orden: 124 },
            ],
          },
        },
      })),
    });

    await expect(gateway.getActivities()).resolves.toEqual([
      { id: 620100, name: 'SERVICIOS DE CONSULTORES EN INFORMATICA' },
    ]);
  });

  it('traduce FEXErr a un error de ARCA con el codigo de WSFEX', async () => {
    const gateway = createGateway({
      getParamIncoterms: vi.fn(async () => ({
        FEXGetPARAM_IncotermsResult: {
          FEXErr: { ErrCode: 1501, ErrMsg: 'Servicio no autorizado' },
          FEXEvents: { EventCode: 0, EventMsg: '' },
        },
      })),
    });

    await expect(gateway.getIncoterms()).rejects.toThrow(/Servicio no autorizado/);
  });

  it('lee el ultimo comprobante y el ultimo ID, con 0 si ARCA no informa nada', async () => {
    const getLastCmp = vi.fn(async () => ({
      FEXGetLast_CMPResult: { ...EMPTY_RESULT, FEXResult_LastCMP: { Cbte_nro: 41, Cbte_fecha: '20260531' } },
    }));
    const gateway = createGateway({
      getLastCmp,
      getLastId: vi.fn(async () => ({ FEXGetLast_IDResult: { ...EMPTY_RESULT, FEXResultGet: {} } })),
    });

    await expect(gateway.getLastVoucherNumber(3)).resolves.toBe(41);
    expect(getLastCmp).toHaveBeenCalledWith({ Cbte_Tipo: 19, Punto_venta: 3 });
    await expect(gateway.getLastRequestId()).resolves.toBe(0);
  });

  it('pide las cotizaciones de aduana con la fecha en yyyymmdd y normaliza el dia de cada moneda', async () => {
    const getParamMonConCotizacion = vi.fn(async () => ({
      FEXGetPARAM_MON_CON_COTIZACIONResult: {
        ...EMPTY_RESULT,
        FEXResultGet: {
          ClsFEXResponse_Mon_CON_Cotizacion: [
            { Fecha_ctz: '27/10/2026', Mon_Id: 'DOL', Mon_ctz: '1174' },
            { Fecha_ctz: '27/10/2026', Mon_Id: ' PES ', Mon_ctz: '0' },
            { Fecha_ctz: '', Mon_Id: '060', Mon_ctz: '1300.5' },
          ],
        },
      },
    }));
    const gateway = createGateway({ getParamMonConCotizacion });

    // Fecha_CTZ va en yyyymmdd: con guiones ARCA contesta "El campo Fecha_CTZ ... YYYYMMDD" (2054).
    await expect(gateway.getQuotations('2026-10-28')).resolves.toEqual([
      { code: 'DOL', date: '20261027', rate: 1174 },
      { code: '060', date: undefined, rate: 1300.5 },
    ]);
    expect(getParamMonConCotizacion).toHaveBeenCalledWith({ Fecha_CTZ: '20261028' });
  });

  it('acepta una sola moneda donde el WSDL promete un array', async () => {
    const gateway = createGateway({
      getParamMonConCotizacion: vi.fn(async () => ({
        FEXGetPARAM_MON_CON_COTIZACIONResult: {
          ...EMPTY_RESULT,
          FEXResultGet: {
            ClsFEXResponse_Mon_CON_Cotizacion: { Fecha_ctz: '27/10/2026', Mon_Id: 'DOL', Mon_ctz: '1174' },
          },
        },
      })),
    });

    await expect(gateway.getQuotations('2026-10-28')).resolves.toEqual([{ code: 'DOL', date: '20261027', rate: 1174 }]);
  });

  it('devuelve una lista vacia si ARCA no tiene cotizaciones para esa fecha', async () => {
    const gateway = createGateway({
      getParamMonConCotizacion: vi.fn(async () => ({
        FEXGetPARAM_MON_CON_COTIZACIONResult: { ...EMPTY_RESULT, FEXResultGet: {} },
      })),
    });

    await expect(gateway.getQuotations('2027-01-05')).resolves.toEqual([]);
  });

  it('informa el error de ARCA cuando no puede consultar las cotizaciones', async () => {
    const gateway = createGateway({
      getParamMonConCotizacion: vi.fn(async () => ({
        FEXGetPARAM_MON_CON_COTIZACIONResult: {
          ...EMPTY_RESULT,
          FEXErr: {
            ErrCode: 2054,
            ErrMsg: 'El campo Fecha_CTZ es de integracion obligatoria y debe tener el siguiente formato: YYYYMMDD',
          },
        },
      })),
    });

    await expect(gateway.getQuotations('2026-10-28')).rejects.toThrow(
      /al consultar las cotizaciones al 2026-10-28: El campo Fecha_CTZ/,
    );
  });

  it('manda el Cmp de authorize tal cual y devuelve la respuesta cruda', async () => {
    const output = { FEXAuthorizeResult: { FEXErr: { ErrCode: 0, ErrMsg: '' }, FEXEvents: {} } };
    const authorize = vi.fn(async () => output);
    const gateway = createGateway({ authorize });
    const payload = { Cbte_Tipo: 19, Id: 1 } as never;

    await expect(gateway.authorize(payload)).resolves.toBe(output);
    expect(authorize).toHaveBeenCalledWith({ Cmp: payload });
  });
});
