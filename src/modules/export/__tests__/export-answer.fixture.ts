import { ArcaExportGateway } from '../../../services/arca/arca-export.gateway';
import { systemClock } from '../../../services/time/system-clock';
import { arcliConfigSchema } from '../../config/config.schemas';
import { EXPORT_VOUCHER_KIND } from '../export.kinds';
import { ExportService } from '../export.service';
import type { ExportResponseSummary, ExportVoucherPayload } from '../export.types';

/** Lo mismo que `emitWithBillingAnswer`, para `FEXAuthorize`. El comprobante no importa: solo lo que contesta el SDK. */
export async function emitWithExportAnswer(answer: unknown): Promise<ExportResponseSummary> {
  const arca = { wsfexService: { authorize: async () => answer } };
  const { response } = await new ExportService({ clock: systemClock }).execute({
    gateway: new ArcaExportGateway(arca as unknown as ConstructorParameters<typeof ArcaExportGateway>[0]),
    resolved: {
      display: { unitNames: {} },
      payload: { Cbte_nro: 8, Id: 42, Punto_vta: 4 } as ExportVoucherPayload,
      voucherKind: EXPORT_VOUCHER_KIND,
      warnings: [],
    },
    runtime: { config: arcliConfigSchema.parse({}), cuit: 20111111112, environment: 'testing' },
  });

  return response;
}
