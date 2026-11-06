import type { ArcliConfig } from '../../modules/config/config.schemas';
import type { ExportExecutionResult, ExportVoucherInput } from '../../modules/export/export.types';
import { resolvePdfDecision } from '../../modules/pdf/pdf-decision';
import { resolvePdfIssuer } from '../../modules/pdf/pdf-issuer';
import { exportExportacionPdf, toPdfFailure } from '../../services/pdf/pdf-exporter';
import { isPromptCancellation } from '../interactive/prompts';
import { startSpinner } from '../spinner';

import { defaultPdfStepDependencies, loadPdfRenderer, type PdfStepDependencies } from './billing.command.pdf';

export interface ExportPdfOptions {
  readonly config: ArcliConfig;
  readonly input: ExportVoucherInput;
  /** Modo interactivo: pide los datos del emisor que faltan antes de generar el PDF. */
  readonly completeConfig?: (config: ArcliConfig) => Promise<ArcliConfig>;
  /** Hay alguien para responder preguntas: terminal interactiva y sin --json. */
  readonly interactive: boolean;
}

/** Sin CAE no hay PDF: ni en vista previa ni en rechazados. */
function canHavePdf(result: ExportExecutionResult): boolean {
  return !result.dryRun && result.response.status !== 'rechazado' && Boolean(result.response.cae);
}

async function ask(deps: PdfStepDependencies, message: string, yesLabel: string): Promise<boolean> {
  try {
    return await deps.confirm(message, yesLabel, 'No');
  } catch (error) {
    // El comprobante ya se emitio: Ctrl+C en la pregunta del PDF es "No", no un error del comando.
    if (isPromptCancellation(error)) {
      return false;
    }

    throw error;
  }
}

/**
 * Genera el PDF del comprobante emitido. El comprobante ya esta emitido, asi que un error del PDF se devuelve en
 * `pdf.error` y no cambia el codigo de salida. Solo lanza lo que lance `completeConfig`, como un Ctrl+C.
 */
export async function attachExportPdf(
  result: ExportExecutionResult,
  options: ExportPdfOptions,
  deps: PdfStepDependencies = defaultPdfStepDependencies,
): Promise<ExportExecutionResult> {
  if (!canHavePdf(result)) {
    return result;
  }

  const decision = resolvePdfDecision({
    flag: options.input.pdf,
    interactive: options.interactive,
    mode: options.config.pdf,
  });

  if (decision === 'omitir') {
    return result;
  }

  if (decision === 'preguntar' && !(await ask(deps, '¿Generamos el PDF del comprobante?', 'Si, generar el PDF'))) {
    return result;
  }

  const config = options.completeConfig ? await options.completeConfig(options.config) : options.config;
  const spinner = startSpinner('Generando PDF...');

  try {
    // Antes de descargar nada: sin los datos del emisor no se puede armar el PDF.
    resolvePdfIssuer(config, result.voucherKind.letter);

    const renderer = await loadPdfRenderer(deps.createPlugin(config), options.interactive, deps);

    const path = await exportExportacionPdf({
      config,
      folder: deps.resolveFolder(config),
      renderer,
      result,
    });

    return { ...result, pdf: { path } };
  } catch (error) {
    return { ...result, pdf: toPdfFailure(error) };
  } finally {
    spinner?.stop();
  }
}
