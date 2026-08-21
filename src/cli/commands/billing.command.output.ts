import { serializeBillingBatch } from '../../modules/billing/billing.serialize';
import type { BillingExecutionResult } from '../../modules/billing/billing.types.internal';
import { formatBillingResultAsJson, formatBillingResultAsText, writeTerminalJson, writeTerminalOutput } from '../../ui';

export function formatBillingOutputs(
  results: BillingExecutionResult[],
  options: {
    readonly environment: 'produccion' | 'testing';
    readonly previewShown?: boolean;
    readonly raw: boolean;
  },
): string {
  return results
    .map((result, index) => {
      const output = formatBillingResultAsText(result, {
        environment: options.environment,
        previewShown: options.previewShown,
        raw: options.raw,
      });

      if (results.length === 1) {
        return output;
      }

      return [`Lote ${index + 1}/${results.length}`, output].join('\n');
    })
    .join('\n\n');
}

export function writeBillingCommandResults(
  results: BillingExecutionResult[],
  options: {
    readonly environment: 'produccion' | 'testing';
    readonly outputJson: boolean;
    readonly previewShown?: boolean;
    readonly raw: boolean;
  },
): void {
  if (options.outputJson) {
    if (results.length === 1) {
      writeTerminalJson(formatBillingResultAsJson(results[0], { raw: options.raw }));

      return;
    }

    writeTerminalJson(JSON.stringify(serializeBillingBatch(results, { raw: options.raw }), null, 2));

    return;
  }

  writeTerminalOutput(
    formatBillingOutputs(results, {
      environment: options.environment,
      previewShown: options.previewShown,
      raw: options.raw,
    }),
  );
}
