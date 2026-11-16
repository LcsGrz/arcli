import type { BillingExecutionResult } from '../billing/billing.types.internal';
import type { ArcliPdfMode } from '../config/config.schemas';

export type PdfDecision = 'generar' | 'omitir' | 'preguntar';

export interface PdfDecisionInput {
  /** `true` con --exportar-pdf, `false` con --sin-pdf. */
  readonly flag?: boolean;
  /** Hay alguien para responder: terminal interactiva y sin --json. */
  readonly interactive: boolean;
  readonly mode?: ArcliPdfMode;
}

/** El flag gana; sin flag decide la config, y "preguntar" sin nadie que responda no genera. */
export function resolvePdfDecision(input: PdfDecisionInput): PdfDecision {
  if (input.flag !== undefined) {
    return input.flag ? 'generar' : 'omitir';
  }

  switch (input.mode ?? 'preguntar') {
    case 'siempre':
      return 'generar';
    case 'nunca':
      return 'omitir';
    case 'preguntar':
      return input.interactive ? 'preguntar' : 'omitir';
  }
}

/** Lo que se elige en "¿Emitimos?": emitir, o emitir y generar el PDF. No emitir se modela aparte. */
export type EmissionChoice = 'emitir' | 'emitir-con-pdf';

export interface EmissionConfirmationPlan {
  /** Con qué opción arranca el cursor. */
  readonly initial: EmissionChoice;
  /** Si se muestra "Sí, emitir y generar el PDF". */
  readonly offerPdf: boolean;
}

/**
 * Las opciones de la confirmación antes de emitir. Con el PDF decidido por flag (`--exportar-pdf` o `--sin-pdf`), solo
 * emitir o no; si no, siempre se ofrece emitir con PDF, diga lo que diga la config, y con `siempre` el cursor
 * arranca ahí. En un lote, `flags` trae uno por comprobante y alcanza con que uno no tenga el PDF decidido.
 */
export function planEmissionConfirmation(input: {
  readonly flags: ReadonlyArray<boolean | undefined>;
  readonly mode?: ArcliPdfMode;
}): EmissionConfirmationPlan {
  const offerPdf = input.flags.some((flag) => flag === undefined);

  return { initial: offerPdf && input.mode === 'siempre' ? 'emitir-con-pdf' : 'emitir', offerPdf };
}

/**
 * El PDF después de confirmar a mano: el flag gana y, si no hay, lo elegido decide. Siempre devuelve un valor
 * explícito, así que después de emitir no se pregunta nada más del PDF.
 */
export function resolvePdfAfterConfirmation(flag: boolean | undefined, choice: EmissionChoice): boolean {
  return flag ?? choice === 'emitir-con-pdf';
}

/** Sin CAE no hay PDF: ni en vista previa ni en rechazados. Un observado tiene CAE y si lleva. */
export function canHavePdf(result: BillingExecutionResult): boolean {
  return !result.dryRun && result.response.status !== 'rechazado' && Boolean(result.response.cae);
}
