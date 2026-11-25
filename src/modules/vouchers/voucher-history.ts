import { AppError } from '../../lib/errors/app-error';
import type { ErrorCode } from '../../lib/errors/error-codes';
import { BILLING_IVA_RATES, documentTypeFromCode, ivaRateFactor } from '../billing/arca-codes';
import type { BillingDocumentType, BillingIvaRate } from '../billing/billing.schemas';

/** Un comprobante asociado (`CbtesAsoc`): el que ajusta una nota. */
export interface IssuedAssociatedVoucher {
  readonly arcaType: number;
  /** CUIT del emisor del asociado; ARCA lo devuelve como texto. */
  readonly cuit?: string;
  readonly date?: string;
  readonly number: number;
  readonly pointOfSale: number;
}

/** Una alicuota de IVA (`Iva.AlicIva`), con el codigo de ARCA (`5` es 21%). */
export interface IssuedIvaAliquot {
  readonly amount: number;
  readonly base: number;
  readonly id: number;
}

/** Un tributo (`Tributos.Tributo`). */
export interface IssuedTax {
  readonly amount: number;
  readonly base: number;
  readonly description?: string;
  readonly id: number;
  readonly rate: number;
}

/** Un dato opcional (`Opcionales.Opcional`): en FCE, CBU, alias, transferencia o anulacion. */
export interface IssuedOptional {
  readonly id: string;
  readonly value: string;
}

/** Comprobante ya emitido, tal como lo devuelve ARCA (FECompConsultar). Fechas en formato yyyymmdd. */
export interface IssuedVoucher {
  readonly associatedPeriod?: { readonly from: string; readonly to: string };
  readonly associatedVouchers?: readonly IssuedAssociatedVoucher[];
  readonly cae?: string;
  readonly caeExpiration?: string;
  readonly concept?: number;
  readonly currency?: string;
  readonly date: string;
  readonly documentNumber: number;
  readonly documentTypeCode: number;
  readonly exchangeRate?: number;
  readonly exemptAmount?: number;
  readonly ivaAliquots?: readonly IssuedIvaAliquot[];
  readonly ivaAmount: number;
  readonly netAmount: number;
  readonly number: number;
  readonly observations?: readonly string[];
  readonly optionals?: readonly IssuedOptional[];
  readonly paymentDueDate?: string;
  readonly receiverIvaConditionCode?: number;
  readonly result?: string;
  /** `CanMisMonExt`: `true` si se cobra en la misma moneda extranjera; `undefined` si ARCA no lo informa. */
  readonly sameCurrency?: boolean;
  readonly serviceFrom?: string;
  readonly serviceTo?: string;
  readonly taxes?: readonly IssuedTax[];
  readonly taxesAmount?: number;
  readonly total: number;
  /** Solo en los que no se pudieron leer (`UnreadableVoucher`). */
  readonly unreadable?: undefined;
  readonly untaxedAmount?: number;
}

/** Lo que se sabe de un comprobante que existe (vino con su numero y su CAE) y no se pudo leer. */
export interface ExistingVoucher {
  readonly cae: string;
  readonly number: number;
}

export interface UnreadableVoucher extends ExistingVoucher {
  readonly unreadable: true;
}

/** Un comprobante de una lista, de wsfe o de wsfex: leido, o que existe y no se pudo leer. */
export type ListedVoucher<T> = T | UnreadableVoucher;

/** ARCA contesto la consulta de un comprobante y no se sabe si existe. `reason` es el motivo solo, para otra frase. */
export class VoucherQueryError extends AppError {
  declare public readonly details: Record<string, unknown>;
  declare public readonly suggestion: string;
  /** Existe, pero no se entiende: una lista no falla entera. Sin definir, no se sabe si existe. */
  public readonly existing?: ExistingVoucher;

  public constructor(
    message: string,
    details: Record<string, unknown>,
    suggestion: string,
    public readonly reason: string,
    options: {
      readonly cause?: unknown;
      /** La `E` sale con `ARCA_EXPORT_ERROR` si ARCA contesta con un error: el codigo es contrato (ARQ-22). */
      readonly code?: ErrorCode;
      readonly existing?: ExistingVoucher;
    } = {},
  ) {
    super(message, { cause: options.cause, code: options.code ?? 'ARCA_VOUCHER_QUERY_ERROR', details, suggestion });
    this.name = 'VoucherQueryError';
    this.existing = options.existing;
  }

  public get exists(): boolean {
    return this.existing !== undefined;
  }
}

/** ARCA contesto con un error. `voucher`, como va en la frase: `el comprobante 00003-00000012`. */
export function voucherQueryErrorMessage(voucher: string, reason: string): string {
  return `ARCA devolvió un error al consultar ${voucher} y no se sabe si existe: ${reason}`;
}

export interface VoucherHistoryGateway {
  getLastNumber(pointOfSale: number, voucherType: number): Promise<number>;
  /** `undefined` solo si ARCA dice que no existe; si contesta otra cosa, falla con `VoucherQueryError`. */
  getVoucher(number: number, pointOfSale: number, voucherType: number): Promise<IssuedVoucher | undefined>;
}

/** Cuantos comprobantes listar si no se pide otra cantidad; se cambia con `config.filasPorLista`. */
export const RECENT_VOUCHERS_LIMIT = 15;
export const MAX_RECENT_VOUCHERS = 50;

export function resolveDocumentType(code: number): BillingDocumentType | undefined {
  return documentTypeFromCode(code);
}

const toCents = (amount: number) => Math.round(amount * 100 + Number.EPSILON);

/**
 * ARCA no devuelve la alicuota de la factura; se deduce del neto y el IVA. Una tasa coincide si el neto por la tasa,
 * redondeado a centavos, da el IVA: con montos chicos la proporcion IVA / neto se aleja de la tasa por el redondeo.
 * Si coinciden varias, gana la mas cercana a esa proporcion.
 */
export function inferIvaRate(netAmount: number, ivaAmount: number): BillingIvaRate | undefined {
  if (netAmount <= 0) {
    return undefined;
  }

  const ratio = ivaAmount / netAmount;
  const factor = (rate: BillingIvaRate) => Number(ivaRateFactor(rate));
  const matches = BILLING_IVA_RATES.filter((rate) => toCents(netAmount * factor(rate)) === toCents(ivaAmount));

  return matches.reduce<BillingIvaRate | undefined>(
    (best, candidate) =>
      !best || Math.abs(factor(candidate) - ratio) < Math.abs(factor(best) - ratio) ? candidate : best,
    undefined,
  );
}

export interface ListVouchersOptions {
  readonly concurrency?: number;
  readonly limit?: number;
}

/** Ultimos comprobantes emitidos, del mas nuevo al mas viejo. */
export async function listRecentVouchers(
  gateway: VoucherHistoryGateway,
  pointOfSale: number,
  voucherType: number,
  options: ListVouchersOptions = {},
): Promise<Array<ListedVoucher<IssuedVoucher>>> {
  const lastNumber = await gateway.getLastNumber(pointOfSale, voucherType);

  return listVouchersFrom(gateway, pointOfSale, voucherType, lastNumber, options);
}

/**
 * Comprobantes desde `fromNumber` hacia atras (incluido), para paginar sin volver a pedir el ultimo numero.
 *
 * @internal Exportado para los tests.
 */
export async function listVouchersFrom(
  gateway: VoucherHistoryGateway,
  pointOfSale: number,
  voucherType: number,
  fromNumber: number,
  options: ListVouchersOptions = {},
): Promise<Array<ListedVoucher<IssuedVoucher>>> {
  return fetchVouchersBackwards(fromNumber, (number) => gateway.getVoucher(number, pointOfSale, voucherType), options);
}

/**
 * Pide los comprobantes desde `fromNumber` hacia atras, del mas nuevo al mas viejo, y descarta los que no existen. Los
 * que existen y no se entienden van en su lugar como `UnreadableVoucher`. Si no se sabe si uno existe, falla la lista.
 * Sirve para wsfe y para wsfex: cada uno sabe como pedir uno.
 */
export async function fetchVouchersBackwards<T extends { readonly unreadable?: undefined }>(
  fromNumber: number,
  fetch: (number: number) => Promise<T | null | undefined>,
  options: ListVouchersOptions = {},
): Promise<Array<ListedVoucher<T>>> {
  const limit = options.limit ?? RECENT_VOUCHERS_LIMIT;
  const concurrency = options.concurrency ?? 4;
  const numbers = Array.from({ length: Math.max(0, Math.min(limit, fromNumber)) }, (_, index) => fromNumber - index);
  const vouchers: Array<ListedVoucher<T> | null | undefined> = [];
  const orUnreadable = (error: unknown): UnreadableVoucher => {
    if (!(error instanceof VoucherQueryError && error.existing)) {
      throw error;
    }

    return { ...error.existing, unreadable: true };
  };

  // Lotes chicos: cada consulta tarda ~0,5 s y no conviene saturar el web service.
  for (let start = 0; start < numbers.length; start += concurrency) {
    const batch = numbers.slice(start, start + concurrency);

    vouchers.push(...(await Promise.all(batch.map((number) => fetch(number).catch(orUnreadable)))));
  }

  return vouchers.filter((voucher): voucher is ListedVoucher<T> => voucher !== null && voucher !== undefined);
}
