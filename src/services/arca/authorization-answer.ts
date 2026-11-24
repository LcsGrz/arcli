import { asArray } from '../../lib/arrays/as-array';
import type { AuthorizationAnswer, BillingAuthorizationAnswer } from '../../modules/billing/authorization-answer';

import type { CreateVoucherResultDto, IFEXAuthorizeOutput } from './arca-sdk.types';

interface RawDetail {
  readonly CAE?: unknown;
  readonly CAEFchVto?: unknown;
  readonly Observaciones?: { readonly Obs?: unknown } | null;
  readonly Resultado?: unknown;
}

/** Donde esta cada dato en lo que devuelve `createVoucher` del SDK. Sin respuesta, falla: no se sabe si se emitio. */
export function readBillingAnswer(output: CreateVoucherResultDto): BillingAuthorizationAnswer {
  // El SDK solo mira el primero de una lista: con un objeto suelto pierde el CAE.
  const detail = asArray<unknown>(output.response?.FeDetResp?.FECAEDetResponse)[0] as RawDetail | undefined;

  return {
    cae: output.cae,
    caeExpiration: output.caeFchVto,
    get detailCae() {
      return detail?.CAE;
    },
    get detailCaeExpiration() {
      return detail?.CAEFchVto;
    },
    errors: output.response?.Errors?.Err,
    events: output.response?.Events?.Evt,
    get headerResult() {
      return output.response?.FeCabResp?.Resultado;
    },
    observations: detail?.Observaciones?.Obs,
    raw: output,
    result: detail?.Resultado,
    // Con el detalle suelto queda sin numero: se usa el que se mando.
    get voucherNumber() {
      return output.response?.FeDetResp?.FECAEDetResponse?.[0]?.CbteDesde;
    },
  };
}

/** Lo mismo con `FEXAuthorize`. */
export function readExportAnswer(output: IFEXAuthorizeOutput): AuthorizationAnswer {
  const result = output.FEXAuthorizeResult;
  const authorization = asArray(result?.FEXResultAuth)[0];

  return {
    cae: authorization?.Cae,
    get caeExpiration() {
      return authorization?.Fch_venc_Cae;
    },
    errors: result?.FEXErr,
    events: result?.FEXEvents,
    observations: authorization?.Motivos_Obs,
    raw: output,
    result: authorization?.Resultado,
    // Con la autorizacion en una lista queda sin numero: se usa el que se mando.
    get voucherNumber() {
      return result?.FEXResultAuth?.Cbte_nro;
    },
  };
}
