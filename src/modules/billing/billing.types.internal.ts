import type { CreateVoucherResultDto } from '@arcasdk/core/lib/application/dto/electronic-billing';
import type { INextVoucher } from '@arcasdk/core/lib/domain/types/voucher.types';

import type { VoucherKindDefinition } from './billing.types';

export interface BillingGateway {
  createNextVoucher(payload: INextVoucher): Promise<CreateVoucherResultDto>;
}

export interface BillingResponseSummary {
  readonly cae: string | null;
  readonly caeVencimiento: string | null;
  readonly errors: unknown[];
  readonly events: unknown[];
  readonly observaciones: string[];
  readonly observacion: string | null;
  readonly raw: CreateVoucherResultDto | null;
  readonly resultado: string | null;
  readonly suggestions: string[];
  readonly status: 'aprobado' | 'observado' | 'rechazado';
}

export interface BillingExecutionResult {
  readonly dryRun: boolean;
  readonly environment: 'produccion' | 'testing';
  readonly payload: INextVoucher;
  readonly response: BillingResponseSummary;
  readonly voucherKind: VoucherKindDefinition;
}
