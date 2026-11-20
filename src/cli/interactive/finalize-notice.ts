import type { WizardStep } from '../../modules/interactive/wizard';
import { noticePanel, writeTerminalOutput } from '../../ui';

/**
 * Los pasos de un flujo, mostrando el error de `finalize` (una regla que no se cumple con todas las respuestas) en el
 * paso al que vuelve el asistente, antes de preguntar de nuevo. En un grupo de opcionales se muestra una vez, antes de
 * la pregunta que escribe el campo.
 */
export function withFinalizeNotice<S>(steps: ReadonlyArray<WizardStep<S>>): Array<WizardStep<S>> {
  return steps.map((step) => ({
    ...step,
    run: (state, options) => {
      if (options.error) {
        writeTerminalOutput(noticePanel(options.error, 'warning'));
      }

      return step.run(state, options);
    },
  }));
}
