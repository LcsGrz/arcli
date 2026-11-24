import { InputValidationError } from '../../lib/errors/app-error';
import type { ArcliPdfMode } from '../config/config.schemas';

export type PdfDecision = 'generar' | 'omitir' | 'preguntar';

interface PdfDecisionInput {
  /** `true` con --exportar-pdf, `false` con --sin-pdf. */
  readonly flag?: boolean;
  /** Hay alguien para responder: terminal interactiva y sin --json. */
  readonly interactive: boolean;
  readonly mode?: ArcliPdfMode;
}

export interface PdfFlagInput {
  /** `--exportar-pdf` o su alias `--pdf`. */
  readonly exportPdf: boolean;
  /** `"pdf"` del JSON de `--cargar`. */
  readonly filePdf?: boolean;
  /** `--sin-pdf`. */
  readonly skipPdf: boolean;
}

/**
 * El `flag` que recibe `resolvePdfDecision`, igual en A, B, C y la E: los flags ganan y, sin ellos, vale `"pdf"` del
 * archivo. Sin ninguno queda `undefined` y decide la config.
 */
export function resolvePdfFlag(input: PdfFlagInput): boolean | undefined {
  if (input.exportPdf && input.skipPdf) {
    throw new InputValidationError('Usá `--exportar-pdf` o `--sin-pdf`, pero no ambos a la vez.');
  }

  if (input.exportPdf) {
    return true;
  }

  return input.skipPdf ? false : input.filePdf;
}

/**
 * El flag gana; sin flag decide la config, y "preguntar" sin nadie que responda no genera.
 *
 * @internal Exportado para los tests.
 */
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

/** Lo que hace falta de un resultado de cualquier familia para saber si puede llevar PDF. */
interface PdfCandidateResult {
  readonly dryRun: boolean;
  readonly response: { readonly cae?: string | null; readonly status: string };
}

/** Sin CAE no hay PDF: ni en vista previa ni en rechazados. Un observado tiene CAE y si lleva. */
export function canHavePdf(result: PdfCandidateResult): boolean {
  return !result.dryRun && result.response.status !== 'rechazado' && Boolean(result.response.cae);
}

/** Que hacer con el PDF de cada comprobante, en orden y en todas las familias. `preguntar` lo responde quien llama. */
export function decidePdfs(options: {
  readonly interactive: boolean;
  readonly mode?: ArcliPdfMode;
  readonly vouchers: ReadonlyArray<{ readonly flag?: boolean; readonly result: PdfCandidateResult }>;
}): PdfDecision[] {
  const { interactive, mode } = options;

  return options.vouchers.map(({ flag, result }) =>
    canHavePdf(result) ? resolvePdfDecision({ flag, interactive, mode }) : 'omitir',
  );
}

/** Las decisiones con la respuesta a la pregunta: una sola para todos los que habia que preguntar. */
export function answerPdfDecisions(
  decisions: readonly PdfDecision[],
  accepted: boolean,
): ReadonlyArray<Exclude<PdfDecision, 'preguntar'>> {
  return decisions.map((decision) => (decision === 'preguntar' ? (accepted ? 'generar' : 'omitir') : decision));
}
