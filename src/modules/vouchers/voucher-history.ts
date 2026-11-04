import type { BillingDocumentType, BillingIvaRate } from '../billing/billing.schemas';

/** Comprobante ya emitido, tal como lo devuelve ARCA (FECompConsultar). Fechas en formato yyyymmdd. */
export interface IssuedVoucher {
  readonly cae?: string;
  readonly caeExpiration?: string;
  readonly concept?: number;
  readonly currency?: string;
  readonly date: string;
  readonly documentNumber: number;
  readonly documentTypeCode: number;
  readonly exchangeRate?: number;
  readonly exemptAmount?: number;
  readonly ivaAmount: number;
  readonly netAmount: number;
  readonly number: number;
  readonly result?: string;
  readonly taxesAmount?: number;
  readonly total: number;
  readonly untaxedAmount?: number;
}

export interface VoucherHistoryGateway {
  getLastNumber(pointOfSale: number, voucherType: number): Promise<number>;
  getVoucher(number: number, pointOfSale: number, voucherType: number): Promise<IssuedVoucher | undefined>;
}

const DOCUMENT_TYPES_BY_CODE: Record<number, BillingDocumentType> = {
  80: 'cuit',
  86: 'cuil',
  96: 'dni',
  99: 'consumidor-final',
};

const IVA_RATES: ReadonlyArray<readonly [BillingIvaRate, number]> = [
  ['0', 0],
  ['2.5', 0.025],
  ['5', 0.05],
  ['10.5', 0.105],
  ['21', 0.21],
  ['27', 0.27],
];

/** Cuantos comprobantes listar si no se pide otra cantidad; se cambia con `config.comprobantesPorLista`. */
export const RECENT_VOUCHERS_LIMIT = 15;
export const MAX_RECENT_VOUCHERS = 50;

export function resolveDocumentType(code: number): BillingDocumentType | undefined {
  return DOCUMENT_TYPES_BY_CODE[code];
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
  const matches = IVA_RATES.filter(([, rate]) => toCents(netAmount * rate) === toCents(ivaAmount));
  const closest = matches.reduce<(typeof IVA_RATES)[number] | undefined>(
    (best, candidate) => (!best || Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio) ? candidate : best),
    undefined,
  );

  return closest?.[0];
}

interface ListVouchersOptions {
  readonly concurrency?: number;
  readonly limit?: number;
}

/** Ultimos comprobantes emitidos, del mas nuevo al mas viejo. */
export async function listRecentVouchers(
  gateway: VoucherHistoryGateway,
  pointOfSale: number,
  voucherType: number,
  options: ListVouchersOptions = {},
): Promise<IssuedVoucher[]> {
  const lastNumber = await gateway.getLastNumber(pointOfSale, voucherType);

  return listVouchersFrom(gateway, pointOfSale, voucherType, lastNumber, options);
}

/** Comprobantes desde `fromNumber` hacia atras (incluido), para paginar sin volver a pedir el ultimo numero. */
export async function listVouchersFrom(
  gateway: VoucherHistoryGateway,
  pointOfSale: number,
  voucherType: number,
  fromNumber: number,
  options: ListVouchersOptions = {},
): Promise<IssuedVoucher[]> {
  const limit = options.limit ?? RECENT_VOUCHERS_LIMIT;
  const concurrency = options.concurrency ?? 4;
  const numbers = Array.from({ length: Math.max(0, Math.min(limit, fromNumber)) }, (_, index) => fromNumber - index);
  const vouchers: Array<IssuedVoucher | undefined> = [];

  // Lotes chicos: cada consulta tarda ~0,5 s y no conviene saturar el web service.
  for (let start = 0; start < numbers.length; start += concurrency) {
    const batch = numbers.slice(start, start + concurrency);

    vouchers.push(...(await Promise.all(batch.map((number) => gateway.getVoucher(number, pointOfSale, voucherType)))));
  }

  return vouchers.filter((voucher): voucher is IssuedVoucher => Boolean(voucher));
}
