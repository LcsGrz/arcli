import type { AuthorizationAnswer, BillingAuthorizationAnswer } from '../modules/billing/authorization-answer';
import { ArcaBillingGateway } from '../services/arca/arca-billing.gateway';
import { ArcaExportGateway } from '../services/arca/arca-export.gateway';

type SdkClient = ConstructorParameters<typeof ArcaBillingGateway>[0];

/** Lo que devuelve el gateway de A, B y C si el SDK contesta `output`, leido por el gateway real. */
export async function billingAnswer(output: unknown): Promise<BillingAuthorizationAnswer> {
  const arca = { electronicBillingService: { createVoucher: async () => output } } as unknown as SdkClient;

  return new ArcaBillingGateway(arca).createVoucher({} as never);
}

/** Lo mismo, para la E. */
export async function exportAnswer(output: unknown): Promise<AuthorizationAnswer> {
  const arca = { wsfexService: { authorize: async () => output } } as unknown as SdkClient;

  return new ArcaExportGateway(arca).authorize({} as never);
}
