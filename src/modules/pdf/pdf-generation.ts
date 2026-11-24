import type { BillingCommandInput } from '../billing/billing.schemas';
import type { BillingExecutionResult } from '../billing/billing.types.internal';
import type { ArcliConfig } from '../config/config.schemas';
import type { ExportExecutionResult } from '../export/export.types';

import type { PdfOutcome, PdfVoucherExtras } from './pdf.types';
import { toPdfFailure } from './pdf-failure';
import { resolvePdfIssuer } from './pdf-issuer';

/** Un comprobante emitido y lo que solo va en su PDF. La E lo lleva todo en el comprobante: no tiene extras. */
export type PdfVoucher =
  | { readonly extras: PdfVoucherExtras; readonly family: 'billing'; readonly result: BillingExecutionResult }
  | { readonly family: 'export'; readonly result: ExportExecutionResult };

type PdfIssuerConfig = Pick<ArcliConfig, 'cuit' | 'emisor'>;

/** El puerto que genera y guarda un PDF: el renderer y los archivos son de `services/pdf`. Devuelve la ruta. */
export interface PdfExporter {
  export(voucher: PdfVoucher, config: PdfIssuerConfig): Promise<string>;
}

type BillingPdfInput = Pick<
  BillingCommandInput,
  'pdfDescription' | 'receiverAddress' | 'receiverName' | 'saleCondition'
>;

function resolveSaleCondition(input: BillingPdfInput, config: Pick<ArcliConfig, 'condicionVenta'>): string | undefined {
  return input.saleCondition === null ? undefined : (input.saleCondition ?? config.condicionVenta);
}

/** Un comprobante A, B, C o FCE con los datos del PDF de su entrada; la condicion de venta puede salir de la config. */
export function billingPdfVoucher(
  result: BillingExecutionResult,
  input: BillingPdfInput,
  config: Pick<ArcliConfig, 'condicionVenta'>,
): PdfVoucher {
  return {
    extras: {
      condicionVenta: resolveSaleCondition(input, config),
      descripcion: input.pdfDescription,
      receptorDomicilio: input.receiverAddress,
      receptorNombre: input.receiverName,
    },
    family: 'billing',
    result,
  };
}

export interface GeneratePdfsOptions {
  readonly config: PdfIssuerConfig;
  /**
   * Se llama recien con los datos del emisor completos, y una vez: puede preguntar, instalar o fallar, y entonces
   * ninguno tiene PDF.
   */
  readonly loadExporter: () => Promise<PdfExporter>;
  readonly vouchers: readonly PdfVoucher[];
}

/**
 * Genera los PDF de comprobantes ya emitidos, de cualquier familia, de a uno y en orden. Nunca lanza: un PDF que falla
 * es su `error`, no cambia la emision ni frena a los demas. Sin los datos del emisor no se carga nada.
 */
export async function generatePdfs({ config, loadExporter, vouchers }: GeneratePdfsOptions): Promise<PdfOutcome[]> {
  const [first] = vouchers;

  if (!first) {
    return [];
  }

  let exporter: PdfExporter;

  try {
    resolvePdfIssuer(config, first.result.voucherKind.letter);
    exporter = await loadExporter();
  } catch (error) {
    return vouchers.map(() => toPdfFailure(error));
  }

  const outcomes: PdfOutcome[] = [];

  for (const voucher of vouchers) {
    try {
      outcomes.push({ path: await exporter.export(voucher, config) });
    } catch (error) {
      outcomes.push(toPdfFailure(error));
    }
  }

  return outcomes;
}
