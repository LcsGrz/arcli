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
/**
 * Solo en el asistente, con algun dato editable (TUI-29).
 *
 * @internal Exportado para los tests.
 */
export const EDIT_DATA_LABEL = 'No, editar datos';
/** @internal Exportado para los tests. */
export const DO_NOT_EMIT_LABEL = 'No, dejar sin emitir';

/** "No, editar datos": el asistente abre la lista de datos para cambiar (TUI-29). */
export const EDIT_DATA = 'editar-datos' as const;
export type EditData = typeof EDIT_DATA;

/**
 * "¿Emitimos?" con las opciones que arma `planEmissionConfirmation`: emitir, emitir y generar el PDF (si el PDF no
 * vino decidido por flag) o no emitir. En los comandos con flags, Esc cuenta como no. En el asistente (`'volver'`), Esc
 * devuelve BACK: vuelve a la ultima pregunta (TUI-15). Con `editable`, solo en el asistente, se suma "No, editar datos"
 * antes de no emitir, sin cambiar la opcion inicial (TUI-29).
 */
export async function askEmission(question: string, plan: EmissionConfirmationPlan): Promise<EmissionChoice | false>;
export async function askEmission(
  question: string,
  plan: EmissionConfirmationPlan,
  escape: 'volver',
  options?: { readonly editable: boolean },
): Promise<Back | EditData | EmissionChoice | false>;
export async function askEmission(
  question: string,
  plan: EmissionConfirmationPlan,
  escape?: 'volver',
  options: { readonly editable: boolean } = { editable: false },
): Promise<Back | EditData | EmissionChoice | false> {
  const editable = escape === 'volver' && options.editable;

  return chooseOne<Back | EditData | EmissionChoice | false>(
    question,
    [
      { name: EMIT_NOW_LABEL, value: 'emitir' },
      ...(plan.offerPdf ? [{ name: EMIT_WITH_PDF_LABEL, value: 'emitir-con-pdf' as const }] : []),
      ...(editable ? [{ name: EDIT_DATA_LABEL, value: EDIT_DATA }] : []),
      { name: DO_NOT_EMIT_LABEL, value: false },
    ],
    plan.initial,
    escape === 'volver'
      ? { escapeLabel: 'volver', escapeValue: BACK }
      : { escapeLabel: 'no emitir', escapeValue: false },
  );
}
