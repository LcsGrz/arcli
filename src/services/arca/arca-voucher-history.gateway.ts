import type { Arca } from '@arcasdk/core';

import type { IssuedVoucher, VoucherHistoryGateway } from '../../modules/interactive/voucher-history';

export class ArcaVoucherHistoryGateway implements VoucherHistoryGateway {
  public constructor(private readonly arca: Arca) {}

  public async getLastNumber(pointOfSale: number, voucherType: number): Promise<number> {
    const result = await this.arca.electronicBillingService.getLastVoucher(pointOfSale, voucherType);

    return result.cbteNro ?? 0;
  }

  public async getVoucher(
    number: number,
    pointOfSale: number,
    voucherType: number,
  ): Promise<IssuedVoucher | undefined> {
    const info = await this.arca.electronicBillingService.getVoucherInfo(number, pointOfSale, voucherType);

    if (!info?.cbteFch || info.resultado !== 'A') {
      return undefined;
    }

    return {
      cae: info.codAutorizacion,
      concept: info.concepto,
      date: info.cbteFch,
      documentNumber: info.docNro ?? 0,
      documentTypeCode: info.docTipo ?? 99,
      ivaAmount: info.impIVA ?? 0,
      netAmount: info.impNeto ?? 0,
      number,
      total: info.impTotal ?? 0,
    };
  }
}
