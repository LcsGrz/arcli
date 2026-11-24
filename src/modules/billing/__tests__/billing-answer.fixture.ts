import { ArcaBillingGateway } from '../../../services/arca/arca-billing.gateway';
import { systemClock } from '../../../services/time/system-clock';
import { billingCommandSchema } from '../billing.schemas';
import { BillingService } from '../billing.service';
import type { BillingResponseSummary } from '../billing.types.internal';

/**
 * El resumen de lo que contesta el SDK a la llamada que emite, por el servicio y el gateway reales (ARQ-4): no depende
 * de en que capa se lee la respuesta. Lo que no se puede leer sale como `EmissionUncertainError`.
 */
export async function emitWithBillingAnswer(answer: unknown): Promise<BillingResponseSummary> {
  const arca = {
    electronicBillingService: { createVoucher: async () => answer, getLastVoucher: async () => ({ cbteNro: 41 }) },
  };
  const { response } = await new BillingService({ clock: systemClock }).emit({
    gateway: new ArcaBillingGateway(arca as unknown as ConstructorParameters<typeof ArcaBillingGateway>[0]),
    input: billingCommandSchema.parse({
      concept: 'servicios',
      documentType: 'consumidor-final',
      dryRun: false,
      emit: true,
      ivaCondition: 'consumidor-final',
      shortcut: 'fc',
      totalAmount: 1000,
    }),
    runtime: { cuit: 20111111112, environment: 'testing', pointOfSale: 3 },
  });

  return response;
}
