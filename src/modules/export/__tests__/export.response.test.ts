import type { IFEXAuthorizeOutput } from '@arcasdk/core/lib/application/dto/fex';
import { describe, expect, it } from 'vitest';

import { createDryRunExportResponse, mapExportResponse } from '../export.response';

function authorization(overrides: Record<string, unknown> = {}): IFEXAuthorizeOutput {
  return {
    FEXAuthorizeResult: {
      FEXErr: { ErrCode: 0, ErrMsg: '' },
      FEXEvents: { EventCode: 0, EventMsg: '' },
      FEXResultAuth: {
        Cae: '75123456789012',
        Cbte_nro: 12,
        Cbte_tipo: 19,
        Cuit: 20111111112,
        Fch_cbte: '20260601',
        Fch_venc_Cae: '20260611',
        Id: 7,
        Motivos_Obs: '',
        Punto_vta: 3,
        Reproceso: 'N',
        Resultado: 'A',
        ...overrides,
      },
    },
  };
}

describe('mapExportResponse', () => {
  it('arma el resumen aprobado con el CAE y su vencimiento', () => {
    const summary = mapExportResponse(authorization());

    expect(summary).toMatchObject({
      cae: '75123456789012',
      caeVencimiento: '20260611',
      errors: [],
      events: [],
      observacion: null,
      observaciones: [],
      resultado: 'A',
      status: 'aprobado',
    });
  });

  it('normaliza el vencimiento cuando ARCA manda la hora', () => {
    expect(mapExportResponse(authorization({ Fch_venc_Cae: '2026-06-11 00:00:00' })).caeVencimiento).toBe('20260611');
  });

  it('no toma como error el `OK` que manda ARCA con codigo 0 en una autorizacion exitosa', () => {
    // Asi contesta WSFEX cuando autoriza: FEXErr con ErrCode 0 y ErrMsg "OK".
    const summary = mapExportResponse({
      FEXAuthorizeResult: {
        FEXErr: { ErrCode: 0, ErrMsg: 'OK' },
        FEXEvents: { EventCode: 0, EventMsg: '' },
        FEXResultAuth: authorization().FEXAuthorizeResult.FEXResultAuth,
      },
    } as IFEXAuthorizeOutput);

    expect(summary.errors).toEqual([]);
    expect(summary.status).toBe('aprobado');
    expect(summary.cae).toBe('75123456789012');
  });

  it('un rechazo queda como rechazado, sin CAE y con sugerencia', () => {
    const summary = mapExportResponse(
      authorization({ Cae: '', Motivos_Obs: 'El pais de destino no es valido', Resultado: 'R' }),
    );

    expect(summary.status).toBe('rechazado');
    expect(summary.cae).toBeNull();
    expect(summary.observaciones).toEqual(['El pais de destino no es valido']);
    expect(summary.suggestions.length).toBeGreaterThan(0);
  });

  it('un error de ARCA en FEXErr tambien es un rechazo', () => {
    // WSFEX devuelve FEXErr sin FEXResultAuth: el tipo del SDK lo exige, la respuesta real no lo trae.
    const summary = mapExportResponse({
      FEXAuthorizeResult: {
        FEXErr: { ErrCode: 1601, ErrMsg: 'El numero de comprobante no es correlativo' },
        FEXEvents: { EventCode: 0, EventMsg: '' },
      },
    } as unknown as IFEXAuthorizeOutput);

    expect(summary.status).toBe('rechazado');
    expect(summary.errors).toEqual([{ code: 1601, message: 'El numero de comprobante no es correlativo' }]);
    expect(summary.suggestions.join(' ')).toMatch(/numero del comprobante/);
  });

  it('sugiere revisar la actividad cuando ARCA la rechaza por no estar vinculada al emisor', () => {
    const summary = mapExportResponse({
      FEXAuthorizeResult: {
        FEXErr: {
          ErrCode: 2105,
          ErrMsg: 'La actividad seleccionada 620900 no se encuentra vinculada al emisor o no esta activa',
        },
        FEXEvents: { EventCode: 0, EventMsg: '' },
      },
    } as unknown as IFEXAuthorizeOutput);

    expect(summary.status).toBe('rechazado');
    expect(summary.suggestions.join(' ')).toMatch(/vinculada al emisor/);
    expect(summary.suggestions.join(' ')).toMatch(/--actividad/);
  });

  it('un comprobante observado conserva el CAE', () => {
    const summary = mapExportResponse(authorization({ Motivos_Obs: 'Observacion informativa' }));

    expect(summary.status).toBe('observado');
    expect(summary.cae).toBe('75123456789012');
    expect(summary.observacion).toBe('Observacion informativa');
  });

  it('la vista previa no tiene CAE ni respuesta cruda', () => {
    expect(createDryRunExportResponse()).toMatchObject({ cae: null, raw: null, status: 'observado' });
  });
});
