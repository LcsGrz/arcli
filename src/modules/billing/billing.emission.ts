import type { Clock } from '../../lib/time/clock';

import { type BatchScope, type EmissionOutcome, emitBatch, notifyEmitted, type OnEmitted } from './billing.batch-run';
import { shouldEmit } from './billing.emit-decision';
import type { BillingPreviewItem } from './billing.preview';
import type { BillingCommandInput } from './billing.schemas';
import { type BillingEmissionGateway, BillingService } from './billing.service';
import type { BillingExecutionResult, BillingRuntime } from './billing.types.internal';
import type { EmissionInterruption } from './emission-interruption';

/** Un comprobante previsualizado, despues de preguntar (o no) si se emite. */
export interface BillingDecidedItem extends BillingPreviewItem {
  /** Alguien vio su vista previa y confirmo: se emite su solicitud tal cual (ARQ-21). */
  readonly confirmed?: boolean;
}

/**
 * Un lugar del lote al emitir: un comprobante que se emite, o la vista previa de uno que no. La vista previa no trae
 * la entrada: no hay con que emitirla.
 */
export type BillingEmissionItem =
  | {
      readonly index: number;
      readonly input: BillingCommandInput;
      readonly kind: 'emission';
      /** La que se confirmo. Sin ella se arma al emitir. */
      readonly preview?: BillingExecutionResult;
      readonly warnings: readonly string[];
    }
  | { readonly index: number; readonly kind: 'preview'; readonly result: BillingExecutionResult };

/** Que se emite y que queda en vista previa, segun cada entrada (`shouldEmit`), en el orden del lote. */
export function planBillingEmission(items: readonly BillingDecidedItem[]): BillingEmissionItem[] {
  return items.map(({ confirmed, index, input, preview, warnings }) =>
    shouldEmit(input)
      ? { index, input, kind: 'emission', preview: confirmed ? preview : undefined, warnings }
      : { index, kind: 'preview', result: preview },
  );
}

export interface EmitBillingOptions extends EmissionInterruption {
  readonly clock: Clock;
  readonly gateway: BillingEmissionGateway;
  readonly items: readonly BillingEmissionItem[];
  /** Cada comprobante, apenas ARCA lo responde y antes de seguir con el proximo. Tambien un rechazo. Ver `OnEmitted`. */
  readonly onEmitted?: OnEmitted<BillingExecutionResult>;
  readonly runtime: BillingRuntime;
  readonly scope: BatchScope;
}

/**
 * Emite A, B, C y FCE, de a uno y en orden. Nunca tira: si se corta devuelve lo procesado (en un lote mixto, tambien
 * las vistas previas) y el error, para que quien llama entregue lo emitido antes de informarlo.
 */
export async function emitBilling(options: EmitBillingOptions): Promise<EmissionOutcome<BillingExecutionResult>> {
  const { gateway, items, onEmitted, runtime, scope } = options;
  const service = new BillingService({ clock: options.clock });

  return emitBatch({
    emit: async (item, _position, beforeSending) => {
      if (item.kind === 'preview') {
        return item.result;
      }

      const { input, preview, warnings } = item;

      return service.emit({ beforeSending, gateway, input, preview, runtime, warnings });
    },
    interruption: options,
    isIssued: ({ dryRun, response }) => !dryRun && Boolean(response.cae),
    items,
    onAnswered: async (item, result, position) => {
      if (item.kind === 'emission') {
        await notifyEmitted(onEmitted, result, position);
      }
    },
    scope,
  });
}
