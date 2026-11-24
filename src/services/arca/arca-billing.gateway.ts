import { addDaysToArcaDate, formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { AppError } from '../../lib/errors/app-error';
import type { BillingGateway } from '../../modules/billing/billing.types.internal';

import { toDetailErrors, withDeprecatedErrors } from './arca-error-details';
import type { Arca, CreateVoucherResultDto, IVoucher } from './arca-sdk.types';
import { getLastAuthorizedNumber, rethrowIfWsfeNotAuthorizedToEmit } from './last-voucher';

/** Tope de numeracion de ARCA; el SDK lo valida igual en `createNextVoucher`. */
const MAX_VOUCHER_NUMBER = 99_999_999;

export class ArcaBillingGateway implements BillingGateway {
  public constructor(private readonly arca: Arca) {}

  /**
   * Primer paso de `createNextVoucher` del SDK: autentica en WSAA y pide el ultimo numero autorizado.
   * Si falla, no se envio nada a ARCA. Como el SDK, sin comprobantes previos arranca en 1.
   */
  public async getNextVoucherNumber(pointOfSale: number, voucherType: number): Promise<number> {
    const nextNumber =
      (await getLastAuthorizedNumber(this.arca, pointOfSale, voucherType, rethrowIfWsfeNotAuthorizedToEmit)) + 1;

    if (nextNumber > MAX_VOUCHER_NUMBER) {
      throw new Error(`Número de comprobante no puede ser mayor a ${MAX_VOUCHER_NUMBER}.`);
    }

    return nextNumber;
  }

  /** Segundo paso: la llamada que emite. Si falla, ARCA pudo haber autorizado el comprobante igual. */
  public async createVoucher(voucher: IVoucher): Promise<CreateVoucherResultDto> {
    return this.arca.electronicBillingService.createVoucher(voucher);
  }

  public async getCurrencyCodes(): Promise<string[]> {
    const result = (await this.arca.electronicBillingService
      .getCurrencyTypes()
      .catch(rethrowIfWsfeNotAuthorizedToEmit)) as RawCurrencyTypesResult;
    const errors = result.errors?.err ?? [];

    if (errors.length > 0) {
      throw new AppError(`ARCA devolvió un error al consultar las monedas: ${errors.map((e) => e.msg).join('; ')}`, {
        code: 'ARCA_PARAMETERS_ERROR',
        details: { errores: toDetailErrors(errors) },
      });
    }

    return (result.resultGet?.moneda ?? []).map((row) => String(row.id));
  }

  public async getQuotation(currencyCode: string, arcaDate?: string): Promise<number> {
    if (arcaDate) {
      return this.getQuotationUpTo(currencyCode, arcaDate);
    }

    const result = await this.arca.electronicBillingService
      .getQuotation(currencyCode)
      .catch(rethrowIfWsfeNotAuthorizedToEmit);
    const exchangeRate = result.resultGet?.monCotiz;

    if (typeof exchangeRate !== 'number' || exchangeRate <= 0) {
      throw new AppError(`ARCA no devolvió una cotización válida para ${currencyCode}.`, {
        code: 'ARCA_QUOTATION_ERROR',
        details: withDeprecatedErrors(result.errors, toDetailErrors(result.errors?.err ?? [])),
      });
    }

    return exchangeRate;
  }

  /**
   * La ultima cotizacion publicada hasta `arcaDate`. `FEParamGetCotizacion` acepta `FchCotiz` desde la v4.0 del
   * manual (WSFEv1 v4.7, pp. 13 y 119), pero el SDK no la manda: se llama al metodo con `genericService`. Un dia sin
   * cotizacion (fin de semana o feriado en produccion) responde 602 "Sin Resultados": se pide el anterior, hasta
   * `QUOTATION_LOOKBACK_DAYS` dias.
   */
  private async getQuotationUpTo(currencyCode: string, arcaDate: string): Promise<number> {
    let date = arcaDate;
    let errors: ArcaQuotationError[] = [];

    for (let attempt = 0; attempt < QUOTATION_LOOKBACK_DAYS; attempt += 1) {
      const response = (await this.arca.genericService
        .call('wsfe', 'FEParamGetCotizacion', { FchCotiz: date, MonId: currencyCode })
        .catch(rethrowIfWsfeNotAuthorizedToEmit)) as RawQuotationResponse | undefined;
      const result = response?.FEParamGetCotizacionResult;
      const exchangeRate = Number(result?.ResultGet?.MonCotiz);

      if (Number.isFinite(exchangeRate) && exchangeRate > 0) {
        return exchangeRate;
      }

      errors = asArray(result?.Errors?.Err).map((error) => ({
        code: Number(error.Code),
        msg: String(error.Msg ?? ''),
      }));

      if (!errors.some((error) => error.code === NO_RESULTS_ERROR)) {
        break;
      }

      date = addDaysToArcaDate(date, -1);
    }

    throw new AppError(
      `ARCA no devolvió una cotización válida para ${currencyCode} al ${formatArcaDateAsArgentineDate(arcaDate)}.`,
      {
        code: 'ARCA_QUOTATION_ERROR',
        details: withDeprecatedErrors({ err: errors }, toDetailErrors(errors)),
      },
    );
  }
}

/** "Sin Resultados" de los metodos de parametros de WSFE. */
const NO_RESULTS_ERROR = 602;
/** Cuantos dias para atras se busca una cotizacion publicada: alcanza para un fin de semana largo. */
const QUOTATION_LOOKBACK_DAYS = 7;

interface RawCurrencyTypesResult {
  readonly errors?: { readonly err?: ReadonlyArray<{ readonly code: number; readonly msg: string }> };
  readonly resultGet?: { readonly moneda?: ReadonlyArray<{ readonly id: number | string }> };
}

interface ArcaQuotationError {
  readonly code: number;
  readonly msg: string;
}

interface RawQuotationResponse {
  readonly FEParamGetCotizacionResult?: {
    readonly Errors?: { readonly Err?: RawArcaError | RawArcaError[] };
    readonly ResultGet?: { readonly FchCotiz?: string; readonly MonCotiz?: number | string };
  };
}

interface RawArcaError {
  readonly Code?: number | string;
  readonly Msg?: string;
}

/** El XML de ARCA trae un solo elemento donde el WSDL promete un array. */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}
