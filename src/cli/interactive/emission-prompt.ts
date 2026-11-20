import type { EmissionChoice, EmissionConfirmationPlan } from '../../modules/pdf/pdf-decision';

import { chooseOne } from './prompts';

/** Los botones de "¿Emitimos?": los mismos en los comandos con flags y en el asistente. */
export const EMIT_NOW_LABEL = 'Sí, emitir ahora';
const EMIT_WITH_PDF_LABEL = 'Sí, emitir y generar el PDF';
export const DO_NOT_EMIT_LABEL = 'No, dejar sin emitir';

/**
 * "¿Emitimos?" con las opciones que arma `planEmissionConfirmation`: emitir, emitir y generar el PDF (si el PDF no
 * vino decidido por flag) o no emitir. Esc cuenta como no.
 */
export async function askEmission(
  question: string,
  plan: EmissionConfirmationPlan,
  escapeLabel = 'no emitir',
): Promise<EmissionChoice | false> {
  return chooseOne<EmissionChoice | false>(
    question,
    [
      { name: EMIT_NOW_LABEL, value: 'emitir' },
      ...(plan.offerPdf ? [{ name: EMIT_WITH_PDF_LABEL, value: 'emitir-con-pdf' as const }] : []),
      { name: DO_NOT_EMIT_LABEL, value: false },
    ],
    plan.initial,
    { escapeLabel, escapeValue: false },
  );
}
