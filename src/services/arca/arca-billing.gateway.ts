import type { Arca } from '@arcasdk/core';
import type { CreateVoucherResultDto } from '@arcasdk/core/lib/application/dto/electronic-billing';
import type { INextVoucher } from '@arcasdk/core/lib/domain/types/voucher.types';

import type { BillingGateway } from '../../modules/billing/billing.types.internal';

export class ArcaBillingGateway implements BillingGateway {
  public constructor(private readonly arca: Arca) {}

  public async createNextVoucher(payload: INextVoucher): Promise<CreateVoucherResultDto> {
    return this.arca.electronicBillingService.createNextVoucher(payload);
  }
}
