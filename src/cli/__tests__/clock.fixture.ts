import { afterAll, beforeEach, vi } from 'vitest';

import { type ArcaProfileFixture, useArcaProfileFixture } from './arca-profile.fixture';

/**
 * Lo comun de los tests del reloj (REV-48, tanda 2): el SDK de ARCA falso, la config real en una carpeta temporal y
 * solo `Date` simulado. Se mira lo que recibe el SDK, que es lo que recibiria ARCA.
 *
 * El proceso corre en UTC: en la medianoche de Argentina la fecha local ya es la del dia siguiente, asi que leer la
 * fecha del equipo en lugar de la argentina tambien hace fallar los tests.
 */

/** El ultimo milisegundo del 10/11/2026 en Argentina. */
export const BEFORE_MIDNIGHT = new Date('2026-11-11T02:59:59.999Z');
/** El primero del 11/11/2026. */
export const AFTER_MIDNIGHT = new Date('2026-11-11T03:00:00.000Z');

export const CLIENT_CUIT = 30709965812;

/** Claves de config de los tests del reloj: punto de venta, actividad de la E, sin PDF y sin padron. */
export const CLOCK_CONFIG = {
  consultarPadron: false,
  exportacion: { actividad: 620100 },
  pdf: 'nunca',
  puntoVentaPorDefecto: 3,
};

export const sdk = {
  generic: { call: vi.fn() },
  padron: { getTaxpayerDetails: vi.fn() },
  wsfe: { createVoucher: vi.fn(), getLastVoucher: vi.fn(), getQuotation: vi.fn(), getSalesPoints: vi.fn() },
  wsfecred: { consultarMontoObligadoRecepcion: vi.fn() },
  wsfex: {
    authorize: vi.fn(),
    getCmp: vi.fn(),
    getLastCmp: vi.fn(),
    getLastId: vi.fn(),
    getParamActividades: vi.fn(),
    getParamDstCuit: vi.fn(),
    getParamDstPais: vi.fn(),
    getParamIdiomas: vi.fn(),
    getParamIncoterms: vi.fn(),
    getParamMon: vi.fn(),
    getParamMonConCotizacion: vi.fn(),
    getParamUMed: vi.fn(),
  },
};

/** El modulo `@arcasdk/core` para `vi.mock`, sin red. */
export function fakeArcaSdk(actual: Record<string, unknown>): Record<string, unknown> {
  return {
    ...actual,
    Arca: class {
      public readonly electronicBillingService = sdk.wsfe;
      public readonly genericService = sdk.generic;
      public readonly registerInscriptionProofService = sdk.padron;
      public readonly wsfecredService = sdk.wsfecred;
      public readonly wsfexService = sdk.wsfex;
    },
    AuthRepository: class {
      public getAuthParams() {
        return { Auth: { Cuit: 20123456786, Sign: 'firma', Token: 'token' } };
      }

      public async login() {
        return {};
      }
    },
  };
}

const OK = { FEXErr: { ErrCode: 0, ErrMsg: 'OK' }, FEXEvents: { EventCode: 0, EventMsg: 'OK' } };

export interface WsfeRequest {
  readonly CbteDesde: number;
  readonly CbteFch: string;
  readonly CbteTipo: number;
  readonly FchServDesde?: string;
  readonly FchServHasta?: string;
  readonly FchVtoPago?: string;
}

export async function approveWsfe(request: WsfeRequest) {
  return {
    cae: '76463926585341',
    caeFchVto: '20261121',
    response: {
      FeDetResp: {
        FECAEDetResponse: [{ CbteDesde: request.CbteDesde, CbteHasta: request.CbteDesde, Resultado: 'A' }],
      },
    },
  };
}

/** ARCA rechaza la fecha (10016), sin CAE. */
export async function rejectWsfe(request: WsfeRequest) {
  return {
    cae: '',
    caeFchVto: '',
    response: {
      FeDetResp: {
        FECAEDetResponse: [
          {
            CbteDesde: request.CbteDesde,
            CbteHasta: request.CbteDesde,
            Observaciones: { Obs: [{ Code: 10016, Msg: 'Fecha fuera de rango' }] },
            Resultado: 'R',
          },
        ],
      },
    },
  };
}

/** `FECompConsultar`: el comprobante que ajusta una nota o que se repite, aprobado. El numero `missing` no existe (602). */
export function answerAssociated(
  overrides: Record<string, unknown> = {},
  { byNumber = {}, missing }: { readonly byNumber?: Record<number, object>; readonly missing?: number } = {},
): void {
  sdk.generic.call.mockImplementation(async (_service: string, method: string, params?: unknown) => {
    if (method === 'FEParamGetCotizacion') {
      return { FEParamGetCotizacionResult: { ResultGet: { FchCotiz: '20261109', MonCotiz: 1450, MonId: 'DOL' } } };
    }

    if (method !== 'FECompConsultar') {
      throw new Error(`genericService.call(${method}) sin respuesta falsa`);
    }

    const { FeCompConsReq } = (params ?? {}) as { FeCompConsReq?: { CbteNro?: number } };

    if (missing !== undefined && FeCompConsReq?.CbteNro === missing) {
      return { FECompConsultarResult: { Errors: { Err: [{ Code: 602, Msg: 'Sin Resultados' }] } } };
    }

    return {
      FECompConsultarResult: {
        ResultGet: {
          CbteFch: '20261101',
          CodAutorizacion: '76000000000012',
          Concepto: 2,
          DocNro: 0,
          DocTipo: 99,
          FchServDesde: '20261001',
          FchServHasta: '20261031',
          FchVto: '20261120',
          ImpIVA: 0,
          ImpNeto: 5000,
          ImpOpEx: 0,
          ImpTotConc: 0,
          ImpTotal: 5000,
          ImpTrib: 0,
          MonCotiz: 1,
          MonId: 'PES',
          Resultado: 'A',
          ...overrides,
          ...byNumber[FeCompConsReq?.CbteNro ?? 0],
        },
      },
    };
  });
}

const fex = (method: string, result: unknown) => ({ [`${method}Result`]: { ...OK, FEXResultGet: result } });

function resetSdk(): void {
  for (const service of Object.values(sdk)) {
    for (const mock of Object.values(service)) {
      mock.mockReset();
    }
  }

  answerAssociated();
  sdk.wsfe.createVoucher.mockImplementation(approveWsfe);
  sdk.wsfe.getLastVoucher.mockResolvedValue({ cbteNro: 41 });
  sdk.wsfe.getQuotation.mockResolvedValue({ resultGet: { fchCotiz: '20261109', monCotiz: 1452.5, monId: 'DOL' } });
  sdk.wsfecred.consultarMontoObligadoRecepcion.mockResolvedValue({
    consultarMontoObligadoRecepcionReturn: { montoDesde: 3958316, obligado: 'N' },
  });
  sdk.wsfex.authorize.mockImplementation(
    async ({ Cmp }: { Cmp: { Cbte_nro: number; Cbte_Tipo: number; Fecha_cbte: string; Id: number } }) => ({
      FEXAuthorizeResult: {
        ...OK,
        FEXResultAuth: {
          Cae: '76463926585399',
          Cbte_nro: Cmp.Cbte_nro,
          Cbte_tipo: Cmp.Cbte_Tipo,
          Cuit: 20123456786,
          Fch_cbte: Cmp.Fecha_cbte,
          Fch_venc_Cae: '20261121',
          Id: Cmp.Id,
          Motivos_Obs: '',
          Punto_vta: 3,
          Reproceso: 'N',
          Resultado: 'A',
        },
      },
    }),
  );
  sdk.wsfex.getCmp.mockResolvedValue(
    fex('FEXGetCMP', {
      Cbte_nro: 1,
      Cbte_tipo: 19,
      Cliente: 'ACME LLC',
      Cuit_pais_cliente: 55000002126,
      Domicilio_cliente: '123 Main St',
      Dst_cmp: 212,
      Fecha_cbte: '20261030',
      Forma_pago: 'Transferencia Internacional',
      Idioma_cbte: 1,
      Imp_total: 1500,
      Items: {
        Item: { Pro_ds: 'Consultoría', Pro_precio_uni: 1500, Pro_qty: 1, Pro_total_item: 1500, Pro_umed: 7 },
      },
      Moneda_Id: 'PES',
      Moneda_ctz: 1,
      Punto_vta: 3,
      Resultado: 'A',
      Tipo_expo: 2,
    }),
  );
  sdk.wsfex.getLastCmp.mockResolvedValue({ FEXGetLast_CMPResult: { ...OK, FEXResult_LastCMP: { Cbte_nro: 7 } } });
  sdk.wsfex.getLastId.mockResolvedValue(fex('FEXGetLast_ID', { Id: 41 }));
  sdk.wsfex.getParamActividades.mockResolvedValue(
    fex('FEXGetPARAM_Actividades', { ClsFEXResponse_ActividadTipo: [{ Desc: 'CONSULTORES', Id: 620100 }] }),
  );
  sdk.wsfex.getParamDstCuit.mockResolvedValue(
    fex('FEXGetPARAM_DST_CUIT', {
      ClsFEXResponse_DST_cuit: [{ DST_CUIT: 55000002126, DST_Ds: 'ESTADOS UNIDOS - Persona Jurídica' }],
    }),
  );
  sdk.wsfex.getParamDstPais.mockResolvedValue(
    fex('FEXGetPARAM_DST_pais', { ClsFEXResponse_DST_pais: [{ DST_Codigo: 212, DST_Ds: 'ESTADOS UNIDOS' }] }),
  );
  sdk.wsfex.getParamIdiomas.mockResolvedValue(
    fex('FEXGetPARAM_Idiomas', { ClsFEXResponse_Idi: [{ Idi_Ds: 'Español', Idi_Id: 1 }] }),
  );
  sdk.wsfex.getParamIncoterms.mockResolvedValue(
    fex('FEXGetPARAM_Incoterms', { ClsFEXResponse_Inc: [{ Inc_Ds: 'Free on Board', Inc_Id: 'FOB' }] }),
  );
  sdk.wsfex.getParamMon.mockResolvedValue(
    fex('FEXGetPARAM_MON', { ClsFEXResponse_Mon: [{ Mon_Ds: 'Dolar Estadounidense', Mon_Id: 'DOL' }] }),
  );
  sdk.wsfex.getParamMonConCotizacion.mockResolvedValue(
    fex('FEXGetPARAM_MON_CON_COTIZACION', {
      ClsFEXResponse_Mon_CON_Cotizacion: [{ Fecha_ctz: '09/11/2026', Mon_Id: 'DOL', Mon_ctz: 1450.25 }],
    }),
  );
  sdk.wsfex.getParamUMed.mockResolvedValue(
    fex('FEXGetPARAM_UMed', { ClsFEXResponse_UMed: [{ Umed_Ds: 'unidades', Umed_Id: 7 }] }),
  );
}

/** Pone el reloj en `instant` y lo deja quieto: avanza solo si el test lo mueve. */
export function setClock(instant: Date): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(instant);
}

/** Lo que recibio WSFE en cada emision, en orden. */
export function wsfeRequests(): WsfeRequest[] {
  return sdk.wsfe.createVoucher.mock.calls.map(([request]) => request as WsfeRequest);
}

/** Lo que recibio WSFEX en cada emision, en orden. */
export function wsfexRequests(): Array<{ readonly Fecha_cbte: string; readonly Fecha_pago?: string }> {
  return sdk.wsfex.authorize.mock.calls.map(([input]) => (input as { Cmp: { Fecha_cbte: string } }).Cmp);
}

/** Config aislada, certificados y terminal de la fixture del perfil, con el SDK falso y el proceso en UTC. */
export function useClockFixture(): ArcaProfileFixture {
  const originalTimeZone = process.env.TZ;

  process.env.TZ = 'UTC';

  const profile = useArcaProfileFixture();

  beforeEach(resetSdk);

  afterAll(() => {
    if (originalTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimeZone;
    }
  });

  return profile;
}
