import {
  BatchEmissionError,
  type BatchItemError,
  BatchValidationError,
  describeBatchItemError,
} from '../../modules/billing/billing.batch';

interface BatchPlan {
  readonly inputIndexes: readonly number[];
  readonly invalidItems: readonly BatchItemError[];
  readonly total: number;
}

/**
 * En un lote, valida todos los comprobantes antes de emitir el primero. `validate` tira si el item es
 * invalido (lectura del JSON o reglas de negocio). Si alguno falla, no se emite ninguno y se informan todos.
 */
export function validateBatchBeforeEmitting<T>(
  plan: BatchPlan,
  inputs: readonly T[],
  validate: (input: T) => void,
): void {
  if (plan.total === 1) {
    return;
  }

  const errors: BatchItemError[] = [...plan.invalidItems];

  inputs.forEach((input, position) => {
    try {
      validate(input);
    } catch (error) {
      errors.push({ index: plan.inputIndexes[position] ?? position + 1, message: describeBatchItemError(error) });
    }
  });

  if (errors.length > 0) {
    throw new BatchValidationError(
      [...errors].sort((left, right) => left.index - right.index),
      plan.total,
    );
  }
}

/**
 * Emite los items en orden. Si uno falla a mitad del lote, entrega lo ya procesado a `onPartialResults`
 * antes de cortar: si no se mostrara, alguien volveria a correr el lote y duplicaria comprobantes.
 */
export async function emitBatch<T, R>(options: {
  readonly emit: (input: T, position: number) => Promise<R>;
  readonly inputs: readonly T[];
  readonly onPartialResults: (results: R[]) => void;
  readonly plan: BatchPlan;
}): Promise<R[]> {
  const { emit, inputs, onPartialResults, plan } = options;
  const results: R[] = [];

  for (const [position, input] of inputs.entries()) {
    try {
      results.push(await emit(input, position));
    } catch (error) {
      if (plan.total === 1) {
        throw error;
      }

      if (results.length > 0) {
        onPartialResults(results);
      }

      throw new BatchEmissionError({
        cause: error,
        emitted: results.length,
        failedIndex: plan.inputIndexes[position] ?? position + 1,
        total: plan.total,
      });
    }
  }

  return results;
}
