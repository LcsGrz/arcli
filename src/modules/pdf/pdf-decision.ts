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

/** Sin CAE no hay PDF: ni en vista previa ni en rechazados. Un observado tiene CAE y si lleva. */
export function canHavePdf(result: BillingExecutionResult): boolean {
  return !result.dryRun && result.response.status !== 'rechazado' && Boolean(result.response.cae);
}
