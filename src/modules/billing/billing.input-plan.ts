import { type BatchItemError, toBatchItemError } from './billing.batch';
import type { EmitDecisionSource } from './billing.emit-decision';
import { type BillingInputOptions, resolveBillingInput, type ResolvedBillingInput } from './billing.input';
import { parseBillingJsonInput, readBillingJsonItems } from './billing.json-input';
import type { BillingCommandInput } from './billing.schemas';

export interface BillingInputPlan {
  /** Posicion en el lote (desde 1) de cada item de `inputs`. */
  readonly inputIndexes: number[];
  readonly inputs: BillingCommandInput[];
  /** Items del lote que no se pudieron leer; el comando no emite nada si hay alguno. */
  readonly invalidItems: BatchItemError[];
  /**
   * `--cargar` trajo un array: es un lote aunque tenga un solo elemento (sale como array y con errores
   * `BATCH_*`). Un objeto o los flags son un comprobante suelto.
   */
  readonly isBatch: boolean;
  readonly modeSource: EmitDecisionSource;
  /** Cantidad de items del lote (1 si no hay lote). */
  readonly total: number;
}

type BillingInputContext = Omit<BillingInputOptions, 'file'>;

interface BillingInputPlanOptions extends BillingInputContext {
  /** El JSON de `--cargar` sin validar; `undefined` es que no hay archivo. */
  readonly source?: unknown;
}

/** El nivel mas fuerte de los que decidieron emitir o no en algun comprobante. */
function strongestModeSource(resolved: readonly ResolvedBillingInput[]): EmitDecisionSource {
  const bySource = (source: EmitDecisionSource) => resolved.some(({ modeSource }) => modeSource === source);

  return (['flags', 'file'] as const).find(bySource) ?? 'default';
}

/** Se leen todos y se juntan los errores, para informarlos de una vez en lugar de cortar en el primero. */
function resolveBatch(items: readonly unknown[], context: BillingInputContext): BillingInputPlan {
  const resolved: ResolvedBillingInput[] = [];
  const inputIndexes: number[] = [];
  const invalidItems: BatchItemError[] = [];

  items.forEach((item, position) => {
    try {
      resolved.push(resolveBillingInput({ ...context, file: parseBillingJsonInput(item) }));
      inputIndexes.push(position + 1);
    } catch (error) {
      invalidItems.push(toBatchItemError(position + 1, error));
    }
  });

  return {
    inputIndexes,
    inputs: resolved.map(({ input }) => input),
    invalidItems,
    isBatch: true,
    modeSource: strongestModeSource(resolved),
    total: items.length,
  };
}

/** Los comprobantes de un comando: un lote, o uno solo (un objeto o los flags), que falla con su propio error. */
export function resolveBillingInputPlan({ source, ...context }: BillingInputPlanOptions): BillingInputPlan {
  const items = source === undefined ? [] : readBillingJsonItems(source);

  if (Array.isArray(source)) {
    return resolveBatch(items, context);
  }

  const file = source === undefined ? undefined : parseBillingJsonInput(items[0]);
  const { input, modeSource } = resolveBillingInput({ ...context, file });

  return { inputIndexes: [1], inputs: [input], invalidItems: [], isBatch: false, modeSource, total: 1 };
}
