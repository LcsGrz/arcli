import type { BillingPreviewGateways } from '../modules/billing/billing.preview';
import type { BillingGateway } from '../modules/billing/billing.types.internal';
import { ArcaBillingGateway } from '../services/arca/arca-billing.gateway';
import type { ArcaClient } from '../services/arca/arca-client.factory';
import { ArcaFceObligationGateway } from '../services/arca/arca-fce-obligation.gateway';
import { ArcaFceRegistryGateway } from '../services/arca/arca-fce-registry.gateway';
import { ArcaPadronGateway } from '../services/arca/arca-padron.gateway';
import { ArcaParametersGateway } from '../services/arca/arca-parameters.gateway';
import { ArcaVoucherHistoryGateway } from '../services/arca/arca-voucher-history.gateway';

/** Los gateways de ARCA con los que se previsualiza y emite A, B, C y FCE. */
export interface BillingGateways extends BillingPreviewGateways {
  readonly billing: BillingGateway;
}

/** Los mismos en los comandos con flags y en el asistente (REV-53). */
export function createBillingGateways(arca: ArcaClient): BillingGateways {
  return {
    billing: new ArcaBillingGateway(arca),
    fce: new ArcaFceObligationGateway(arca),
    fceRegistry: new ArcaFceRegistryGateway(arca),
    history: new ArcaVoucherHistoryGateway(arca),
    padron: new ArcaPadronGateway(arca),
    salesPoints: new ArcaParametersGateway(arca),
  };
}
