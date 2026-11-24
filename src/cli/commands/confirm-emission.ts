import { CANCELLED_NOTICE, NOTHING_EMITTED_NOTICE } from '../../modules/billing/billing.mappers';
import type { EmissionChoice, EmissionConfirmationPlan } from '../../modules/pdf/pdf-decision';
import { noticePanel, writeTerminalOutput } from '../../ui';
import { askEmission } from '../interactive/emission-prompt';
import { isPromptCancellation } from '../interactive/prompts';

/** El de cualquier comando cortado con Ctrl+C: no termino lo que se pidio. */
const CANCELLED_EXIT_CODE = 1;

/**
 * "¿Emitimos?" de los comandos con flags, en A, B, C y E. Con "No" o Esc avisa que no se emitio nada; con Ctrl+C
 * tambien, y el comando sale con 1. Las dos cosas son ciertas aca porque esta pregunta va antes de emitir.
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
    if (!isPromptCancellation(error)) {
      throw error;
    }

    writeTerminalOutput(noticePanel(CANCELLED_NOTICE, 'muted'));
    process.exitCode = CANCELLED_EXIT_CODE;

    return false;
  }
}
