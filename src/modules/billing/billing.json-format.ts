import { serializeBillingResult } from './billing.serialize';
import type { BillingExecutionResult } from './billing.types.internal';

interface BillingJsonOptions {
  readonly raw?: boolean;
}

export function formatBillingResultAsJson(result: BillingExecutionResult, options: BillingJsonOptions = {}): string {
  return JSON.stringify(serializeBillingResult(result, { raw: options.raw }), null, 2);
}
