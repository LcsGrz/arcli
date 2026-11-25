import { BACK, type Back } from '../../modules/interactive/wizard';
import type { EmissionChoice, EmissionConfirmationPlan } from '../../modules/pdf/pdf-decision';

import { chooseOne } from './prompts';

/**
 * Los botones de "¿Emitimos?": los mismos en los comandos con flags y en el asistente.
 *
 * @internal Exportado para los tests.
 */
export const EMIT_NOW_LABEL = 'Sí, emitir ahora';
const EMIT_WITH_PDF_LABEL = 'Sí, emitir y generar el PDF';
/** @internal Exportado para los tests. */
export const DO_NOT_EMIT_LABEL = 'No, dejar sin emitir';

/**
 * "¿Emitimos?" con las opciones que arma `planEmissionConfirmation`: emitir, emitir y generar el PDF (si el PDF no
 * vino decidido por flag) o no emitir. En los comandos con flags, Esc cuenta como no. En el asistente (`'volver'`), Esc
 * devuelve BACK: vuelve a la ultima pregunta (TUI-15).
 */
export async function askEmission(question: string, plan: EmissionConfirmationPlan): Promise<EmissionChoice | false>;
export async function askEmission(
  question: string,
  plan: EmissionConfirmationPlan,
  escape: 'volver',
): Promise<Back | EmissionChoice | false>;
export async function askEmission(
  question: string,
  plan: EmissionConfirmationPlan,
  escape?: 'volver',
): Promise<Back | EmissionChoice | false> {
  return chooseOne<Back | EmissionChoice | false>(
    question,
    [
      { name: EMIT_NOW_LABEL, value: 'emitir' },
      ...(plan.offerPdf ? [{ name: EMIT_WITH_PDF_LABEL, value: 'emitir-con-pdf' as const }] : []),
      { name: DO_NOT_EMIT_LABEL, value: false },
    ],
    plan.initial,
    escape === 'volver'
      ? { escapeLabel: 'volver', escapeValue: BACK }
      : { escapeLabel: 'no emitir', escapeValue: false },
  );
}
