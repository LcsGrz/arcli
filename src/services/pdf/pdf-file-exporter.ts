import type { PdfExporter } from '../../modules/pdf/pdf-generation';

import { exportBillingPdf, exportExportacionPdf } from './pdf-exporter';
import type { PdfRenderer } from './pdf-plugin';

/** El exportador de siempre: renderiza con el plugin y guarda en `folder`, sin pisar un archivo existente. */
export function createPdfFileExporter(options: {
  readonly folder: string;
  readonly renderer: PdfRenderer;
}): PdfExporter {
  return {
    export: async (voucher, config) =>
      voucher.family === 'billing'
        ? exportBillingPdf({ ...options, config, extras: voucher.extras, result: voucher.result })
        : exportExportacionPdf({ ...options, config, result: voucher.result }),
  };
}
