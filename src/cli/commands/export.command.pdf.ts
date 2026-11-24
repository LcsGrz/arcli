import type { ArcliConfig } from '../../modules/config/config.schemas';
import type { ExportExecutionResult, ExportVoucherInput } from '../../modules/export/export.types';
import { decidePdfs } from '../../modules/pdf/pdf-decision';
import { generatePdfs } from '../../modules/pdf/pdf-generation';
import { startSpinner } from '../spinner';

import {
  confirmPdfs,
  defaultPdfStepDependencies,
  loadPdfExporter,
  type PdfStepDependencies,
  withCancellationAsNo,
} from './billing.command.pdf';

export interface ExportPdfOptions {
  readonly config: ArcliConfig;
  readonly input: ExportVoucherInput;
  /** Modo interactivo: pide los datos del emisor que faltan antes de generar el PDF. */
  readonly completeConfig?: (config: ArcliConfig) => Promise<ArcliConfig>;
  /** Hay alguien para responder preguntas: terminal interactiva y sin --json. */
  readonly interactive: boolean;
}

/**
 * Genera el PDF del comprobante emitido. El comprobante ya esta emitido, asi que un error del PDF se devuelve en
 * `pdf.error` y no cambia el codigo de salida. Solo lanza lo que lance `completeConfig`, como un Ctrl+C.
 */
export async function attachExportPdf(
  result: ExportExecutionResult,
  options: ExportPdfOptions,
  defaultDeps: PdfStepDependencies = defaultPdfStepDependencies,
): Promise<ExportExecutionResult> {
  const deps = withCancellationAsNo(defaultDeps);

  const [decision] = await confirmPdfs(
    decidePdfs({
      interactive: options.interactive,
      mode: options.config.pdf,
      vouchers: [{ flag: options.input.pdf, result }],
    }),
    deps,
  );

  if (decision === 'omitir') {
    return result;
  }

  const config = options.completeConfig ? await options.completeConfig(options.config) : options.config;
  const spinner = startSpinner('Generando PDF...');

  try {
    const [pdf] = await generatePdfs({
      config,
      loadExporter: () => loadPdfExporter(config, options.interactive, deps),
      vouchers: [{ family: 'export', result }],
    });

    return { ...result, pdf };
  } finally {
    spinner?.stop();
  }
}
