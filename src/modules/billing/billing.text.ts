import { formatPayloadTable, formatResultSummary } from './billing.display';
import { formatRawBillingResponse } from './billing.serialize';
import type { BillingExecutionResult } from './billing.types.internal';
import { formatVoucherText, type VoucherTextOptions } from './voucher-text';

export function formatBillingResultAsText(result: BillingExecutionResult, options: VoucherTextOptions = {}): string {
  return formatVoucherText(
    {
      dryRun: result.dryRun,
      environment: result.environment,
      preview: [formatPayloadTable(result)],
      raw: () => formatRawBillingResponse(result),
      response: result.response,
      summary: formatResultSummary(result),
      title: result.voucherKind.displayName,
      warnings: result.warnings ?? [],
    },
    options,
  );
}
