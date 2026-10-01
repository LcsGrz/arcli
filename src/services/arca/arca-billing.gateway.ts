import type { Arca } from '@arcasdk/core';
import type { CreateVoucherResultDto } from '@arcasdk/core/lib/application/dto/electronic-billing';
import type { INextVoucher } from '@arcasdk/core/lib/domain/types/voucher.types';

import { AppError } from '../../lib/errors/app-error';
import type { BillingGateway } from '../../modules/billing/billing.types.internal';

export class ArcaBillingGateway implements BillingGateway {
  public constructor(private readonly arca: Arca) {}

  public async createNextVoucher(payload: INextVoucher): Promise<CreateVoucherResultDto> {
    return this.arca.electronicBillingService.createNextVoucher(payload);
  }

  public async getQuotation(currencyCode: string): Promise<number> {
    const result = await this.arca.electronicBillingService.getQuotation(currencyCode);
    const exchangeRate = result.resultGet?.monCotiz;

    if (typeof exchangeRate !== 'number' || exchangeRate <= 0) {
      throw new AppError(`ARCA no devolvio una cotizacion valida para ${currencyCode}.`, {
        code: 'ARCA_QUOTATION_ERROR',
        details: { errors: result.errors },
      });
    }

    return exchangeRate;
  }
}
