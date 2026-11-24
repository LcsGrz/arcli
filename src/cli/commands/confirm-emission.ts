import { NOTHING_EMITTED_NOTICE } from '../../modules/billing/billing.mappers';
import type { EmissionChoice, EmissionConfirmationPlan } from '../../modules/pdf/pdf-decision';
import { noticePanel, writeTerminalOutput } from '../../ui';
import { EmissionCancelledError } from '../emission-cancelled';
import { askEmission } from '../interactive/emission-prompt';
import { isPromptCancellation } from '../interactive/prompts';

/**
 * "¿Emitimos?" de los comandos con flags, en A, B, C y E. Con "No" o Esc avisa que no se emitio nada y el comando
 * termina bien; con Ctrl+C lo corta `EmissionCancelledError`, que `reportCliError` muestra y sale con 1. Las dos cosas
 * son ciertas aca porque esta pregunta va antes de emitir.
 */
export async function confirmEmissionOrNotify(
  question: string,
  plan: EmissionConfirmationPlan,
): Promise<EmissionChoice | false> {
  try {
    const choice = await askEmission(question, plan);

    if (!choice) {
      writeTerminalOutput(noticePanel(NOTHING_EMITTED_NOTICE, 'muted'));
    }

    return choice;
  } catch (error) {
    throw isPromptCancellation(error) ? new EmissionCancelledError() : error;
  }
}
