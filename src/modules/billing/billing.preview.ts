import type { Clock } from '../../lib/time/clock';
import type { ArcliConfig } from '../config/config.schemas';
import type { FceObligationGateway } from '../fce/fce-obligation';
import type { FceRegistryGateway } from '../fce/fce-registry';
import type { ParametersGateway } from '../parameters/parameters';
import type { VoucherHistoryGateway } from '../vouchers/voucher-history';

import {
  checkAssociatedInArca,
  checkFceCancellationInRegistry,
  type ReadAssociated,
} from './billing.associated-lookup';
import { type BatchPlan, prepareBatch } from './billing.batch-run';
import { type BillingPreparationGateways, prepareBillingInput, resolveFceWarningsInOrder } from './billing.prepare';
import type { BillingCommandInput } from './billing.schemas';
import { BillingService } from './billing.service';
import type { BillingExecutionResult, BillingRuntime } from './billing.types.internal';

/** Lo que consulta la vista previa. Ninguna de estas llamadas emite, y no hay con que emitir. */
export interface BillingPreviewGateways extends BillingPreparationGateways {
  readonly fce: FceObligationGateway;
  /** Para avisar si el comprador no rechazó el asociado de una nota FCE de anulación. */
  readonly fceRegistry: Pick<FceRegistryGateway, 'getVoucherState'>;
  /**
   * Para consultar el comprobante asociado de una nota antes de la vista previa; si ARCA no lo tiene, el ultimo
   * numero de su punto de venta dice si es de web service (ver `classifyAssociatedPointOfSale`).
   */
  readonly history: Pick<VoucherHistoryGateway, 'getLastNumber' | 'getVoucher'>;
  /** Los puntos de venta de web service del emisor, para un asociado que ARCA no tiene. */
  readonly salesPoints?: Pick<ParametersGateway, 'getSalesPoints'>;
}

export interface PreviewBillingOptions {
  /** El asociado que quien llama ya consulto: la nota que lo lleva se controla igual, sin consultarlo de nuevo. */
  readonly associated?: ReadAssociated;
  readonly clock: Clock;
  /** Avisos de quien llama (certificado, flags salteados): van antes que los de cada comprobante. */
  readonly extraWarnings?: readonly string[];
  readonly gateways: BillingPreviewGateways;
  readonly plan: BatchPlan & { readonly inputs: readonly BillingCommandInput[] };
  readonly runtime: BillingRuntime & { readonly config: Pick<ArcliConfig, 'verificarFce'> };
}

/** Un comprobante listo para mostrar y, si corresponde, emitir. */
export interface BillingPreviewItem {
  /** Su lugar en el lote, desde 1. */
  readonly index: number;
  /** La entrada completada con lo que dijo ARCA: es la que se emite. */
  readonly input: BillingCommandInput;
  readonly preview: BillingExecutionResult;
  readonly warnings: readonly string[];
}

/**
 * La vista previa de A, B, C y FCE, de uno o de un lote: completa cada entrada, la valida, consulta el asociado de las
 * notas y, con el lote ya validado, el regimen FCE. Nunca emite. En un lote junta todos los errores en un
 * `BatchValidationError`; uno suelto falla con el suyo.
 */
export async function previewBilling(options: PreviewBillingOptions): Promise<BillingPreviewItem[]> {
  const { associated, clock, extraWarnings = [], gateways, plan, runtime } = options;
  const service = new BillingService({ clock });
  // En un lote, un fallo del padron o de la cotizacion sale con su indice, junto a los de validacion.
  const prepared = await prepareBatch({
    inputs: plan.inputs,
    plan,
    // El asociado de una nota se consulta aca, una vez: la vista previa ya muestra su fecha y el tope de la NC, y la
    // emision usa la entrada completada sin volver a consultar.
    resolve: async (input, index) => {
      const entry = await prepareBillingInput(service, input, gateways, runtime);
      const checked = await checkAssociatedInArca({
        gateway: gateways.history,
        input: entry.input,
        read: associated,
        runtime,
        salesPoints: gateways.salesPoints,
        service,
      });
      const registryWarnings = await checkFceCancellationInRegistry({
        gateway: gateways.fceRegistry,
        input: checked.input,
        runtime,
        service,
      });
      const warnings = [...extraWarnings, ...entry.warnings, ...checked.warnings, ...registryWarnings];

      // Armarla es validarla: una sola vez, con el mismo dia y con el indice del lote si falla.
      return { index, input: checked.input, preview: service.preview({ input: checked.input, runtime, warnings }) };
    },
  });
  const fceWarnings = runtime.config.verificarFce
    ? await resolveFceWarningsInOrder(
        service,
        prepared.map(({ input }) => input),
        gateways.fce,
      )
    : [];

  return prepared.map(({ preview, ...item }, position) => {
    const warnings = [...(preview.warnings ?? []), ...(fceWarnings[position] ?? [])];

    return { ...item, preview: { ...preview, warnings }, warnings };
  });
}
