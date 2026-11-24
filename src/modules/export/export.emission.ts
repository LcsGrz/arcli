import type { Clock } from '../../lib/time/clock';
import { type EmissionOutcome, emitBatch, notifyEmitted, type OnEmitted } from '../billing/billing.batch-run';

import { type ExportRuntime, ExportService } from './export.service';
import type {
  ExportEmissionGateway,
  ExportExecutionResult,
  ExportPreviewGateway,
  ExportVoucherInput,
  ResolvedExportVoucher,
} from './export.types';

export interface PreviewExportOptions {
  readonly clock: Clock;
  /** Avisos de quien llama (certificado, entrada, flags salteados): van antes que los de la resolucion. */
  readonly extraWarnings?: readonly string[];
  readonly gateway: ExportPreviewGateway;
  readonly input: ExportVoucherInput;
  readonly runtime: ExportRuntime;
}

export interface ExportPreview {
  readonly preview: ExportExecutionResult;
  /** Lo resuelto contra WSFEX: es lo que se emite, tal cual (ARQ-21). */
  readonly resolved: ResolvedExportVoucher;
  readonly warnings: readonly string[];
}

/** La vista previa de la E y sus notas. Consulta WSFEX, tambien el numero siguiente, pero nunca emite. */
export async function previewExport(options: PreviewExportOptions): Promise<ExportPreview> {
  const { extraWarnings = [], gateway, input, runtime } = options;
  const service = new ExportService({ clock: options.clock });
  const resolved = await service.resolve(input, gateway, runtime);
  const warnings = [...extraWarnings, ...(resolved.warnings ?? [])];

  return { preview: service.preview(resolved, runtime, warnings), resolved, warnings };
}

export interface EmitExportOptions extends Pick<ExportPreview, 'resolved' | 'warnings'> {
  readonly clock: Clock;
  readonly gateway: ExportEmissionGateway;
  /** Apenas ARCA responde. Tambien un rechazo. Ver `OnEmitted`. */
  readonly onEmitted?: OnEmitted<ExportExecutionResult>;
  readonly runtime: ExportRuntime;
}

/** Emite la E y sus notas, siempre de a una. Como `emitBilling`: nunca tira, el error vuelve como dato. */
export async function emitExport(options: EmitExportOptions): Promise<EmissionOutcome<ExportExecutionResult>> {
  const { gateway, onEmitted, resolved, runtime, warnings } = options;
  const service = new ExportService({ clock: options.clock });

  return emitBatch({
    emit: async (_item, position) =>
      notifyEmitted(onEmitted, await service.execute({ gateway, resolved, runtime, warnings }), position),
    items: [{ index: 1 }],
    scope: { isBatch: false, total: 1 },
  });
}
