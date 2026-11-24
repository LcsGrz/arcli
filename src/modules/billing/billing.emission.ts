import type { Clock } from '../../lib/time/clock';

import { type BatchPlan, type EmissionOutcome, emitBatch, notifyEmitted } from './billing.batch-run';
import { shouldEmit } from './billing.emit-decision';
import type { BillingPreview } from './billing.preview';
import type { BillingCommandInput } from './billing.schemas';
import { type BillingEmissionGateway, BillingService } from './billing.service';
import type { BillingExecutionResult, BillingRuntime } from './billing.types.internal';

/**
 * Un lugar del lote al emitir: un comprobante que se emite, o la vista previa de uno que no. La vista previa no trae
 * la entrada: no hay con que emitirla.
 */
export type BillingEmissionItem =
  | {
      readonly input: BillingCommandInput;
      readonly kind: 'emission';
      /** La vista previa que se confirmo, y se emite tal cual (ARQ-21). Sin ella se arma al emitir. */
      readonly preview?: BillingExecutionResult;
      readonly warnings?: readonly string[];
    }
  | { readonly kind: 'preview'; readonly result: BillingExecutionResult };

/** Que se emite y que queda en vista previa, segun cada entrada (`shouldEmit`), en el orden del lote. */
export function planBillingEmission(
  options: BillingPreview & {
    /** Las vistas previas que alguien confirmo, si hubo pregunta. */
    readonly confirmed?: readonly BillingExecutionResult[];
  },
): BillingEmissionItem[] {
  return options.previews.map((result, position) => {
    const input = options.inputs[position];

    return input && shouldEmit(input)
      ? { input, kind: 'emission', preview: options.confirmed?.[position], warnings: options.warnings[position] }
      : { kind: 'preview', result };
  });
}

export interface EmitBillingOptions {
  readonly clock: Clock;
  readonly gateway: BillingEmissionGateway;
  readonly items: readonly BillingEmissionItem[];
  /** Cada comprobante, apenas ARCA lo responde y antes de seguir con el proximo. Tambien un rechazo. */
  readonly onEmitted?: (result: BillingExecutionResult) => void;
  readonly plan: Omit<BatchPlan, 'invalidItems'>;
  readonly runtime: BillingRuntime;
}

/**
 * Emite A, B, C y FCE, de a uno y en orden. Nunca tira: si se corta devuelve lo procesado (en un lote mixto, tambien
 * las vistas previas) y el error, para que quien llama entregue lo emitido antes de informarlo.
 */
export async function emitBilling(options: EmitBillingOptions): Promise<EmissionOutcome<BillingExecutionResult>> {
  const { gateway, items, onEmitted, plan, runtime } = options;
  const service = new BillingService({ clock: options.clock });

  return emitBatch({
    emit: async (item) => {
      if (item.kind === 'preview') {
        return item.result;
      }

      const { input, preview, warnings } = item;

      return notifyEmitted(onEmitted, await service.emit({ gateway, input, preview, runtime, warnings }));
    },
    inputs: items,
    plan,
  });
}
