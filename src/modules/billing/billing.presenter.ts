export { formatBillingResultAsJson } from './billing.json-format';
export { formatBillingResultAsText } from './billing.text';

export interface BillingPresenterOptions {
  readonly environment?: 'produccion' | 'testing';
  readonly previewShown?: boolean;
  readonly raw?: boolean;
}
