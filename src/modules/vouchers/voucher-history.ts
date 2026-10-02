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

export const RECENT_VOUCHERS_LIMIT = 10;
export const MAX_RECENT_VOUCHERS = 50;

export function resolveDocumentType(code: number): BillingDocumentType | undefined {
  return DOCUMENT_TYPES_BY_CODE[code];
}

/** ARCA no devuelve la alicuota de la factura; se deduce de IVA / neto cuando coincide con una tasa conocida. */
export function inferIvaRate(netAmount: number, ivaAmount: number): BillingIvaRate | undefined {
  if (netAmount <= 0) {
    return undefined;
  }

  const ratio = ivaAmount / netAmount;
  const match = IVA_RATES.find(([, rate]) => Math.abs(rate - ratio) < 0.001);

  return match?.[0];
}

/** Ultimos comprobantes emitidos, del mas nuevo al mas viejo. */
export async function listRecentVouchers(
  gateway: VoucherHistoryGateway,
  pointOfSale: number,
  voucherType: number,
  options: { readonly concurrency?: number; readonly limit?: number } = {},
): Promise<IssuedVoucher[]> {
  const limit = options.limit ?? RECENT_VOUCHERS_LIMIT;
  const concurrency = options.concurrency ?? 4;
  const lastNumber = await gateway.getLastNumber(pointOfSale, voucherType);
  const numbers = Array.from({ length: Math.min(limit, lastNumber) }, (_, index) => lastNumber - index);
  const vouchers: Array<IssuedVoucher | undefined> = [];

  // Lotes chicos: cada consulta tarda ~0,5 s y no conviene saturar el web service.
  for (let start = 0; start < numbers.length; start += concurrency) {
    const batch = numbers.slice(start, start + concurrency);

    vouchers.push(...(await Promise.all(batch.map((number) => gateway.getVoucher(number, pointOfSale, voucherType)))));
  }

  return vouchers.filter((voucher): voucher is IssuedVoucher => Boolean(voucher));
}
