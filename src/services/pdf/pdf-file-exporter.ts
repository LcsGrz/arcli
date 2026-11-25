import { interruptedPdfError } from '../../modules/pdf/pdf.errors';
import type { PdfExporter } from '../../modules/pdf/pdf-generation';

import { exportBillingPdf, exportExportacionPdf } from './pdf-exporter';
import type { PdfRenderer } from './pdf-plugin';

/** El exportador de siempre: renderiza con el plugin y guarda en `folder`, sin pisar un archivo existente. */
export function createPdfFileExporter(options: {
  readonly folder: string;
  readonly renderer: PdfRenderer;
  /** Abortado mientras se renderizaba, no se escribe el archivo: ya se informo como no generado. */
  readonly signal?: AbortSignal;
}): PdfExporter {
  const renderer: PdfRenderer = {
    render: async (...args) => {
      const bytes = await options.renderer.render(...args);

      if (options.signal?.aborted) {
        throw interruptedPdfError();
      }

      return bytes;
    },
  };
  const { folder } = options;

  return {
    export: async (voucher, config) =>
      voucher.family === 'billing'
        ? exportBillingPdf({ config, extras: voucher.extras, folder, renderer, result: voucher.result })
        : exportExportacionPdf({ config, folder, renderer, result: voucher.result }),
  };
}
