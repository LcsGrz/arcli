import { describe, expect, it } from 'vitest';

import { createDryRunExportResponse } from '../export.response';

import { emitWithExportAnswer } from './export-answer.fixture';

function authorization(overrides: Record<string, unknown> = {}) {
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
  it('arma el resumen aprobado con el CAE y su vencimiento', async () => {
    const summary = await emitWithExportAnswer(authorization());

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

  it('normaliza el vencimiento cuando ARCA manda la hora', async () => {
    expect((await emitWithExportAnswer(authorization({ Fch_venc_Cae: '2026-06-11 00:00:00' }))).caeVencimiento).toBe(
      '20260611',
    );
  });

  it('no toma como error el `OK` que manda ARCA con codigo 0 en una autorizacion exitosa', async () => {
    // Asi contesta WSFEX cuando autoriza: FEXErr con ErrCode 0 y ErrMsg "OK".
    const summary = await emitWithExportAnswer({
      FEXAuthorizeResult: {
        FEXErr: { ErrCode: 0, ErrMsg: 'OK' },
        FEXEvents: { EventCode: 0, EventMsg: '' },
        FEXResultAuth: authorization().FEXAuthorizeResult.FEXResultAuth,
      },
    });

    expect(summary.errors).toEqual([]);
    expect(summary.status).toBe('aprobado');
    expect(summary.cae).toBe('75123456789012');
  });

  it('un rechazo queda como rechazado, sin CAE y con sugerencia', async () => {
    const summary = await emitWithExportAnswer(
      authorization({ Cae: '', Motivos_Obs: 'El pais de destino no es valido', Resultado: 'R' }),
    );

    expect(summary.status).toBe('rechazado');
    expect(summary.cae).toBeNull();
    expect(summary.observaciones).toEqual(['El pais de destino no es valido']);
    expect(summary.suggestions.length).toBeGreaterThan(0);
  });

  it('un error de ARCA en FEXErr tambien es un rechazo', async () => {
    // WSFEX devuelve FEXErr sin FEXResultAuth: el tipo del SDK lo exige, la respuesta real no lo trae.
    const summary = await emitWithExportAnswer({
      FEXAuthorizeResult: {
        FEXErr: { ErrCode: 1601, ErrMsg: 'El numero de comprobante no es correlativo' },
        FEXEvents: { EventCode: 0, EventMsg: '' },
      },
    });

    expect(summary.status).toBe('rechazado');
    expect(summary.errors).toEqual([{ code: 1601, message: 'El numero de comprobante no es correlativo' }]);
    expect(summary.suggestions.join(' ')).toMatch(/número del comprobante/);
  });

  it.each([
    ['El punto de venta no es valido', /--punto-venta/],
    ['El incoterm no es valido', /`FOB`/],
    ['La moneda no es valida', /--moneda/],
  ])('"%s": no manda a `parametros`, que es de wsfe (ARQ-22)', async (Motivos_Obs, hint) => {
    const { suggestions } = await emitWithExportAnswer(authorization({ Cae: '', Motivos_Obs, Resultado: 'R' }));

    expect(suggestions.join(' ')).toMatch(hint);
    expect(suggestions.join(' ')).not.toContain('parametros');
  });

  it('sugiere revisar la actividad cuando ARCA la rechaza por no estar vinculada al emisor', async () => {
    const summary = await emitWithExportAnswer({
      FEXAuthorizeResult: {
        FEXErr: {
          ErrCode: 2105,
          ErrMsg: 'La actividad seleccionada 620900 no se encuentra vinculada al emisor o no esta activa',
        },
        FEXEvents: { EventCode: 0, EventMsg: '' },
      },
    });

    expect(summary.status).toBe('rechazado');
    expect(summary.suggestions.join(' ')).toMatch(/vinculada al emisor/);
    expect(summary.suggestions.join(' ')).toMatch(/--actividad/);
  });

  it('un rechazo por la actividad no dice que está emitido (ERR-20)', async () => {
    const { suggestions } = await emitWithExportAnswer(
      authorization({ Cae: '', Motivos_Obs: 'La actividad no es valida', Resultado: 'R' }),
    );

    expect(suggestions).toEqual([expect.stringContaining('--actividad')]);
  });

  it('un comprobante observado conserva el CAE', async () => {
    const summary = await emitWithExportAnswer(authorization({ Motivos_Obs: 'Observacion informativa' }));

    expect(summary.status).toBe('observado');
    expect(summary.cae).toBe('75123456789012');
    expect(summary.observacion).toBe('Observacion informativa');
  });

  it('una E aprobada con observaciones no sugiere volver a emitir (UI-32)', async () => {
    // Resultado A con Motivos_Obs: ARCA dio CAE, volver a emitir duplicaria el comprobante.
    const summary = await emitWithExportAnswer(authorization({ Motivos_Obs: 'Observacion informativa' }));

    expect(summary.status).toBe('observado');
    expect(summary.suggestions).toEqual([]);
  });

  it('una E rechazada sin otra sugerencia sigue sugiriendo revisar antes de volver a emitir (UI-32)', async () => {
    const generic = 'Revisá observaciones y errores de ARCA antes de volver a emitir.';
    const byResultado = await emitWithExportAnswer(
      authorization({ Cae: '', Motivos_Obs: 'Dato invalido', Resultado: 'R' }),
    );
    const byFexErr = await emitWithExportAnswer({
      FEXAuthorizeResult: {
        FEXErr: { ErrCode: 1601, ErrMsg: 'Dato invalido' },
        FEXEvents: { EventCode: 0, EventMsg: '' },
      },
    });

    expect(byResultado.suggestions).toEqual([generic]);
    expect(byFexErr.suggestions).toEqual([generic]);
  });

  it('sin Resultado, CAE ni FEXErr no se sabe si se emitio (ERR-20)', async () => {
    await expect(emitWithExportAnswer(authorization({ Resultado: '', Cae: '' }))).rejects.toThrow(
      'ARCA contestó sin CAE, sin resultado y sin errores',
    );
  });

  it('con CAE y sin Resultado no sugiere volver a emitir (UI-32)', async () => {
    expect((await emitWithExportAnswer(authorization({ Resultado: '' }))).suggestions).toEqual([]);
  });

  it('el estado sale de Resultado y las observaciones (TEST-16)', async () => {
    expect((await emitWithExportAnswer(authorization())).status).toBe('aprobado');
    expect((await emitWithExportAnswer(authorization({ Motivos_Obs: 'Obs' }))).status).toBe('observado');
    expect((await emitWithExportAnswer(authorization({ Motivos_Obs: '   ' }))).status).toBe('aprobado');
    expect((await emitWithExportAnswer(authorization({ Cae: '', Resultado: 'R' }))).status).toBe('rechazado');
    expect((await emitWithExportAnswer(authorization({ Cae: '', Motivos_Obs: 'Obs', Resultado: 'R' }))).status).toBe(
      'rechazado',
    );
    // Sin Resultado no hay aprobacion que mostrar: no puede salir `aprobado` en el --json.
    expect((await emitWithExportAnswer(authorization({ Resultado: '' }))).status).toBe('observado');
  });

  it('la vista previa no tiene CAE ni respuesta cruda', () => {
    expect(createDryRunExportResponse()).toMatchObject({ cae: null, raw: null, status: 'previsualizacion' });
  });
});
