import { fetchVouchersBackwards, type ListVouchersOptions } from '../vouchers/voucher-history';

import type { ExportGateway, ExportIssuedVoucher } from './export.types';

/** Los ultimos comprobantes E de un tipo en el punto de venta, del mas nuevo al mas viejo. Son lecturas. */
export async function listRecentExportVouchers(
  gateway: Pick<ExportGateway, 'getLastVoucherNumber' | 'getVoucher'>,
  pointOfSale: number,
  arcaType: number,
  options: ListVouchersOptions = {},
): Promise<ExportIssuedVoucher[]> {
  const last = await gateway.getLastVoucherNumber(arcaType, pointOfSale);

  return fetchVouchersBackwards(last, (number) => gateway.getVoucher({ arcaType, number, pointOfSale }), options);
}
