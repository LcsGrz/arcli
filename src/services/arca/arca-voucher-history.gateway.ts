import { addDaysToArcaDate } from '../../lib/dates/arca-date';
import type {
  IssuedAssociatedVoucher,
  IssuedIvaAliquot,
  IssuedOptional,
  IssuedTax,
  IssuedVoucher,
  VoucherHistoryGateway,
} from '../../modules/vouchers/voucher-history';

import type { Arca } from './arca-sdk.types';
import { getLastAuthorizedNumber, rethrowIfWsfeNotAuthorized } from './last-voucher';
import { voucherQueryError } from './voucher-query-error';

type Row = Record<string, unknown>;

export class ArcaVoucherHistoryGateway implements VoucherHistoryGateway {
  public constructor(private readonly arca: Arca) {}

  public async getLastNumber(pointOfSale: number, voucherType: number): Promise<number> {
    return getLastAuthorizedNumber(this.arca, pointOfSale, voucherType);
  }

  /**
   * `FECompConsultar` con `genericService`: `getVoucherInfo` del SDK descarta los asociados, el periodo de servicio,
   * el vencimiento del pago, `CanMisMonExt`, las alicuotas, los tributos, los opcionales y las observaciones (SDK-13).
   */
  public async getVoucher(
    number: number,
    pointOfSale: number,
    voucherType: number,
  ): Promise<IssuedVoucher | undefined> {
    const response = (await this.arca.genericService
      .call('wsfe', 'FECompConsultar', {
        FeCompConsReq: { CbteNro: number, CbteTipo: voucherType, PtoVta: pointOfSale },
      })
      .catch(asNotFoundResponse)) as QueryResponse;
    const result = response?.FECompConsultarResult;
    const rows = readRows(result?.Errors, 'Err') as ReadonlyArray<Row | null>;
    const errors = rows
      .map((error) => ({ code: readNumber(error?.Code) ?? null, msg: readText(error?.Msg) }))
      .filter(({ code, msg }) => code !== null || msg);
    const voucher = mapIssuedVoucher(result?.ResultGet, number);

    if (errors.some(({ code }) => code !== NOT_FOUND_ERROR)) {
      throw voucherQueryError({ errors, number, pointOfSale });
    }

    // Sin el 602, que falte el comprobante no dice que no exista (ERR-1). Un error sin codigo ni mensaje, tampoco.
    if (errors.length < rows.length || (!voucher && errors.length === 0)) {
      throw voucherQueryError({ errors: [], number, pointOfSale });
    }

    return voucher;
  }
}

/** "No existen datos en nuestros registros para los parametros ingresados": el unico que es "no existe". */
const NOT_FOUND_ERROR = 602;

type QueryResponse =
  | { readonly FECompConsultarResult?: { readonly Errors?: unknown; readonly ResultGet?: Row } | null }
  | null
  | undefined;

/**
 * Un 602 lanzado vale como el 602 de la respuesta; el resto sigue. El SDK ademas mira "no existe" en el texto
 * (`isAfipNotFoundError`), pero eso tambien toma un error de red (`El dominio no existe`).
 */
function asNotFoundResponse(error: unknown): QueryResponse {
  if (readNumber((error as Row | null | undefined)?.code) === NOT_FOUND_ERROR) {
    return { FECompConsultarResult: { Errors: { Err: { Code: NOT_FOUND_ERROR } } } };
  }

  return rethrowIfWsfeNotAuthorized(error);
}

/** Una fecha ARCA (yyyymmdd) que existe: ni `00000000` ni `0`. */
function readDate(value: unknown): string | undefined {
  const date = readText(value);

  return /^\d{8}$/.test(date) && addDaysToArcaDate(date, 0) === date ? date : undefined;
}

/** Sin una fecha real no es un comprobante: si existe o no lo dicen los errores de la respuesta. */
function mapIssuedVoucher(row: Row | null | undefined, number: number): IssuedVoucher | undefined {
  const date = readDate(row?.CbteFch);

  if (!row || !date) {
    return undefined;
  }

  const associatedPeriod = readPeriod(row.PeriodoAsoc);

  return {
    ...(associatedPeriod ? { associatedPeriod } : {}),
    associatedVouchers: readRows(row.CbtesAsoc, 'CbteAsoc').flatMap(mapAssociated),
    cae: readOptionalText(row.CodAutorizacion),
    caeExpiration: readOptionalText(row.FchVto),
    concept: readNumber(row.Concepto),
    currency: readOptionalText(row.MonId),
    date,
    documentNumber: readNumber(row.DocNro) ?? 0,
    documentTypeCode: readNumber(row.DocTipo) ?? 99,
    exchangeRate: readNumber(row.MonCotiz),
    exemptAmount: readNumber(row.ImpOpEx) ?? 0,
    ivaAliquots: readRows(row.Iva, 'AlicIva').flatMap(mapIvaAliquot),
    ivaAmount: readNumber(row.ImpIVA) ?? 0,
    netAmount: readNumber(row.ImpNeto) ?? 0,
    number,
    observations: readRows(row.Observaciones, 'Obs').flatMap((obs) => readOptionalText(obs.Msg) ?? []),
    optionals: readRows(row.Opcionales, 'Opcional').flatMap(mapOptional),
    paymentDueDate: readOptionalText(row.FchVtoPago),
    receiverIvaConditionCode: readNumber(row.CondicionIVAReceptorId),
    result: readOptionalText(row.Resultado),
    sameCurrency: readSameCurrency(row.CanMisMonExt),
    serviceFrom: readOptionalText(row.FchServDesde),
    serviceTo: readOptionalText(row.FchServHasta),
    taxes: readRows(row.Tributos, 'Tributo').flatMap(mapTax),
    taxesAmount: readNumber(row.ImpTrib) ?? 0,
    total: readNumber(row.ImpTotal) ?? 0,
    untaxedAmount: readNumber(row.ImpTotConc) ?? 0,
  };
}

function mapAssociated(row: Row): IssuedAssociatedVoucher[] {
  const arcaType = readNumber(row.Tipo);
  const number = readNumber(row.Nro);
  const pointOfSale = readNumber(row.PtoVta);

  if (!arcaType || !number || pointOfSale === undefined) {
    return [];
  }

  const cuit = readOptionalText(typeof row.Cuit === 'number' ? String(row.Cuit) : row.Cuit);
  const date = readOptionalText(row.CbteFch);

  return [{ arcaType, number, pointOfSale, ...(cuit ? { cuit } : {}), ...(date ? { date } : {}) }];
}

function mapIvaAliquot(row: Row): IssuedIvaAliquot[] {
  const id = readNumber(row.Id);

  return id === undefined ? [] : [{ amount: readNumber(row.Importe) ?? 0, base: readNumber(row.BaseImp) ?? 0, id }];
}

function mapTax(row: Row): IssuedTax[] {
  const id = readNumber(row.Id);
  const description = readOptionalText(row.Desc);

  return id === undefined
    ? []
    : [
        {
          amount: readNumber(row.Importe) ?? 0,
          base: readNumber(row.BaseImp) ?? 0,
          ...(description ? { description } : {}),
          id,
          rate: readNumber(row.Alic) ?? 0,
        },
      ];
}

function mapOptional(row: Row): IssuedOptional[] {
  const id = readOptionalText(typeof row.Id === 'number' ? String(row.Id) : row.Id);

  return id ? [{ id, value: readText(row.Valor) }] : [];
}

function readPeriod(value: unknown): IssuedVoucher['associatedPeriod'] {
  const period = value as Row | undefined;
  const from = readOptionalText(period?.FchDesde);
  const to = readOptionalText(period?.FchHasta);

  return from && to ? { from, to } : undefined;
}

function readSameCurrency(value: unknown): boolean | undefined {
  const text = readText(value).toUpperCase();

  return text === 'S' ? true : text === 'N' ? false : undefined;
}

/** El XML de ARCA trae un solo elemento donde el WSDL promete un array, y los arrays vienen envueltos. */
function readRows(value: unknown, key: string): Row[] {
  const rows = (value as Row | null | undefined)?.[key] as Row | Row[] | null | undefined;

  if (rows === undefined || rows === null) {
    return [];
  }

  return Array.isArray(rows) ? rows : [rows];
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readOptionalText(value: unknown): string | undefined {
  return readText(value) || undefined;
}

function readNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;

  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined;
}
