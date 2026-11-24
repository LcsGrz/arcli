import type { EmitDecisionSource } from '../../modules/billing/billing.emit-decision';
import { formatEmissionQuestion } from '../../modules/billing/billing.mappers';
import type { BillingCommandInput } from '../../modules/billing/billing.schemas';
import type { BillingService } from '../../modules/billing/billing.service';
import type { BillingExecutionResult, BillingGateway } from '../../modules/billing/billing.types.internal';
import {
  type EmissionChoice,
  planEmissionConfirmation,
  resolvePdfAfterConfirmation,
} from '../../modules/pdf/pdf-decision';
import { writeTerminalOutput } from '../../ui';
import type { CliArcaRuntime } from '../arca-runtime';

import { formatBillingOutputs } from './billing.command.output';
import { confirmEmissionOrNotify } from './confirm-emission';

export interface InteractiveBillingPreviewOutcome {
  readonly confirmedInteractively: boolean;
  readonly inputs: BillingCommandInput[];
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
  readonly runtime: CliArcaRuntime;
  readonly service: BillingService;
  readonly useRaw: boolean;
  readonly voucherLabel: string;
  readonly warnings?: ReadonlyArray<readonly string[]>;
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

  const previewGateway: BillingGateway = {
    createVoucher: async () => {
      throw new Error('No debería ejecutarse la emisión real durante la vista previa.');
    },
    getNextVoucherNumber: async () => {
      throw new Error('No debería ejecutarse la emisión real durante la vista previa.');
    },
    getQuotation: async () => {
      throw new Error('La cotización se resuelve antes de la vista previa.');
    },
  };
  const previewResults: BillingExecutionResult[] = [];

  for (const [index, input] of options.inputs.entries()) {
    previewResults.push(
      await options.service.execute({
        gateway: previewGateway,
        input,
        runtime: options.runtime,
        warnings: options.warnings?.[index],
      }),
    );
  }

  writeTerminalOutput(
    formatBillingOutputs(previewResults, { environment: options.runtime.environment, raw: options.useRaw }),
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
    previewShown: true,
    proceed: true,
  };
}
