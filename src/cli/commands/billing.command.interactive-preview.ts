import type { EmitDecisionSource } from '../../modules/billing/billing.emit-decision';
import type { BillingCommandInput } from '../../modules/billing/billing.schemas';
import type { BillingExecutionResult } from '../../modules/billing/billing.types.internal';
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
  readonly inputs: BillingCommandInput[];
  /** Las vistas previas confirmadas, alineadas con `inputs`: es lo que se emite (ARQ-21). Sin pregunta, no hay. */
  readonly previews?: readonly BillingExecutionResult[];
  readonly previewShown: boolean;
  readonly proceed: boolean;
}

/**
 * Esc cuenta como no, igual que en el modo interactivo. Si ningun flag decidio el PDF, la pregunta tambien lo
 * decide: despues de emitir no se pregunta nada mas.
 */
function applyEmitDecision(inputs: BillingCommandInput[], choice: EmissionChoice): BillingCommandInput[] {
  return inputs.map((input) => ({
    ...input,
    dryRun: false,
    emit: true,
    pdf: resolvePdfAfterConfirmation(input.pdf, choice),
  }));
}

export async function runInteractiveBillingPreview(options: {
  readonly inputs: BillingCommandInput[];
  readonly modeSource: EmitDecisionSource;
  /** Las vistas previas de `inputs`, en el mismo orden. */
  readonly previews: BillingExecutionResult[];
  readonly runtime: CliArcaRuntime;
  readonly useRaw: boolean;
  readonly voucherLabel: string;
}): Promise<InteractiveBillingPreviewOutcome> {
  const shouldPromptForEmit =
    options.modeSource === 'default' &&
    options.inputs.some((input) => !input.emit) &&
    !options.runtime.outputJson &&
    process.stdin.isTTY &&
    process.stdout.isTTY;

  if (!shouldPromptForEmit) {
    return {
      confirmedInteractively: false,
      inputs: options.inputs,
      previewShown: false,
      proceed: true,
    };
  }

  writeTerminalOutput(
    formatBillingOutputs(options.previews, { environment: options.runtime.environment, raw: options.useRaw }),
  );

  const count = options.inputs.length;
  const choice = await confirmEmissionOrNotify(
    formatEmissionQuestion(count > 1 ? `los ${count} comprobantes` : options.voucherLabel, options.runtime.environment),
    planEmissionConfirmation({ flags: options.inputs.map((input) => input.pdf), mode: options.runtime.config.pdf }),
  );

  if (!choice) {
    return {
      confirmedInteractively: false,
      inputs: options.inputs,
      previewShown: true,
      proceed: false,
    };
  }

  return {
    confirmedInteractively: true,
    inputs: applyEmitDecision(options.inputs, choice),
    previews: options.previews,
    previewShown: true,
    proceed: true,
  };
}
