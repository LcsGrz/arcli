import type { BillingDecidedItem } from '../../modules/billing/billing.emission';
import type { EmitDecisionSource } from '../../modules/billing/billing.emit-decision';
import type { BillingPreviewItem } from '../../modules/billing/billing.preview';
import {
  type EmissionChoice,
  planEmissionConfirmation,
  resolvePdfAfterConfirmation,
} from '../../modules/pdf/pdf-decision';
import { writeTerminalOutput } from '../../ui';
import type { CliArcaRuntime } from '../arca-runtime';
import { formatEmissionQuestion } from '../emission-texts';

import { formatBillingOutputs } from './billing.command.output';
import { confirmEmissionOrNotify } from './confirm-emission';

export interface InteractiveBillingPreviewOutcome {
  readonly confirmedInteractively: boolean;
  /** Los mismos, con lo que se respondio: los confirmados se emiten como los mostro la vista previa (ARQ-21). */
  readonly items: readonly BillingDecidedItem[];
  readonly previewShown: boolean;
  readonly proceed: boolean;
}

/**
 * Esc cuenta como no, igual que en el modo interactivo. Si ningun flag decidio el PDF, la pregunta tambien lo
 * decide: despues de emitir no se pregunta nada mas.
 */
function applyEmitDecision(items: readonly BillingPreviewItem[], choice: EmissionChoice): BillingDecidedItem[] {
  return items.map((item) => ({
    ...item,
    confirmed: true,
    input: { ...item.input, dryRun: false, emit: true, pdf: resolvePdfAfterConfirmation(item.input.pdf, choice) },
  }));
}

export async function runInteractiveBillingPreview(options: {
  readonly items: readonly BillingPreviewItem[];
  readonly modeSource: EmitDecisionSource;
  readonly runtime: CliArcaRuntime;
  readonly useRaw: boolean;
  readonly voucherLabel: string;
}): Promise<InteractiveBillingPreviewOutcome> {
  const shouldPromptForEmit =
    options.modeSource === 'default' &&
    options.items.some(({ input }) => !input.emit) &&
    !options.runtime.outputJson &&
    process.stdin.isTTY &&
    process.stdout.isTTY;

  if (!shouldPromptForEmit) {
    return {
      confirmedInteractively: false,
      items: options.items,
      previewShown: false,
      proceed: true,
    };
  }

  writeTerminalOutput(
    formatBillingOutputs(
      options.items.map(({ preview }) => preview),
      { environment: options.runtime.environment, raw: options.useRaw },
    ),
  );

  const count = options.items.length;
  const choice = await confirmEmissionOrNotify(
    formatEmissionQuestion(count > 1 ? `los ${count} comprobantes` : options.voucherLabel, options.runtime.environment),
    planEmissionConfirmation({ flags: options.items.map(({ input }) => input.pdf), mode: options.runtime.config.pdf }),
  );

  if (!choice) {
    return {
      confirmedInteractively: false,
      items: options.items,
      previewShown: true,
      proceed: false,
    };
  }

  return {
    confirmedInteractively: true,
    items: applyEmitDecision(options.items, choice),
    previewShown: true,
    proceed: true,
  };
}
