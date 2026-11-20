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
      .catch(rethrowIfNotFound)) as { FECompConsultarResult?: { ResultGet?: Row } } | null | undefined;

    return mapIssuedVoucher(response?.FECompConsultarResult?.ResultGet, number);
  }
}

/** Como el SDK: un error "no existe" (602) es que el comprobante no existe. El resto sigue. */
function rethrowIfNotFound(error: unknown): undefined {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };

  if (code === 602 || (typeof message === 'string' && message.toLowerCase().includes('no existe'))) {
    return undefined;
  }

  return rethrowIfWsfeNotAuthorized(error);
}

/** ARCA devuelve sin `ResultGet` (con el error 602) cuando el comprobante no existe. */
function mapIssuedVoucher(row: Row | undefined, number: number): IssuedVoucher | undefined {
  const date = readText(row?.CbteFch);

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
