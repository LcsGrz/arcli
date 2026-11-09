import type { FceObligationGateway } from '../fce/fce-obligation';
import type { PadronGateway } from '../padron/padron';

import { exchangeRateWarnings } from './billing.currency';
import { DUE_DAY_DEPRECATION_WARNING } from './billing.date-range';
import type { BillingCommandInput } from './billing.schemas';
import type { BillingService } from './billing.service';
import type { BillingGateway } from './billing.types.internal';

/** Lo que consulta la preparacion: ninguna de estas llamadas emite. */
export interface BillingPreparationGateways {
  readonly billing: Pick<BillingGateway, 'getQuotation'>;
  readonly padron: PadronGateway;
}

export interface PreparedBillingInput {
  readonly input: BillingCommandInput;
  /** Avisos de la entrada: `--dia` deprecado, cotizacion oficial y lo que encontro el padron. */
  readonly warnings: readonly string[];
}

/**
 * Lo que pasa entre leer la entrada y mostrar la vista previa, igual con flags que en el modo interactivo: completa
 * la condicion IVA desde el padron, pide la cotizacion oficial si hace falta y junta los avisos de la entrada. Los
 * avisos de quien llama (certificado, flags salteados) y los del regimen FCE se suman aparte: el FCE se consulta
 * recien con el lote validado.
 */
export async function prepareBillingInput(
  service: BillingService,
  input: BillingCommandInput,
  gateways: BillingPreparationGateways,
): Promise<PreparedBillingInput> {
  const padron = await service.resolveIvaConditionFromPadron(input, gateways.padron);
  const resolved = await service.resolveExchangeRate(padron.input, gateways.billing);

  return {
    input: resolved,
    warnings: [
      ...(resolved.dueDay ? [DUE_DAY_DEPRECATION_WARNING] : []),
      ...exchangeRateWarnings(resolved),
      ...padron.warnings,
    ],
  };
}

/** Los avisos del regimen FCE de cada comprobante. En orden: cada consulta a wsfecred reutiliza el mismo ticket WSAA. */
export async function resolveFceWarningsInOrder(
  service: BillingService,
  inputs: readonly BillingCommandInput[],
  gateway: FceObligationGateway,
): Promise<string[][]> {
  const warnings: string[][] = [];

  for (const input of inputs) {
    warnings.push(await service.resolveFceWarnings(input, gateway));
  }

  return warnings;
}
