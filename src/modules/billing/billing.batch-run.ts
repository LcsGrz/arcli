import { BatchEmissionError, type BatchItemError, BatchValidationError, toBatchItemError } from './billing.batch';

/** Lo que hace falta de un plan para informar cada fallo con su lugar en el lote. */
export interface BatchPlan {
  readonly inputIndexes: readonly number[];
  readonly invalidItems: readonly BatchItemError[];
  /** Entro un array: se trata como lote aunque tenga un solo item. */
  readonly isBatch: boolean;
  readonly total: number;
}

/**
 * Prepara un lote antes de emitir: `resolve` completa cada item con lo que hay que consultar en ARCA (IVA
 * receptor del padron, cotizacion) y `validate` aplica las reglas de negocio sobre lo resuelto. En un lote
 * no corta en el primer fallo: junta todos, con su indice, en un solo `BatchValidationError`, y no se emite
 * ninguno. Con un comprobante suelto (no un array) el error sale tal cual, como siempre.
 */
export async function prepareBatch<T, R>(options: {
  readonly inputs: readonly T[];
  readonly plan: BatchPlan;
  readonly resolve: (input: T, position: number) => Promise<R>;
  readonly validate: (resolved: R) => void;
}): Promise<R[]> {
  const { inputs, plan, resolve, validate } = options;
  const resolved: R[] = [];

  if (!plan.isBatch) {
    // Secuencial a proposito: cada servicio de ARCA reutiliza su ticket WSAA.
    for (const [position, input] of inputs.entries()) {
      resolved.push(await resolve(input, position));
    }

    return resolved;
  }

  const errors: BatchItemError[] = [...plan.invalidItems];

  for (const [position, input] of inputs.entries()) {
    try {
      const item = await resolve(input, position);

      validate(item);
      resolved.push(item);
    } catch (error) {
      errors.push(toBatchItemError(plan.inputIndexes[position] ?? position + 1, error));
    }
  }

  if (errors.length > 0) {
    throw new BatchValidationError(
      [...errors].sort((left, right) => left.index - right.index),
      plan.total,
    );
  }

  return resolved;
}

/**
 * Lo que dejo una emision. El error es un dato y no una excepcion, para que nunca se pierda lo que ya se proceso: quien
 * llama lo entrega antes de informar el error. Que este la clave `error` es lo que dice que se corto.
 */
export type EmissionOutcome<R> = { readonly results: R[] } | { readonly error: unknown; readonly results: R[] };

/**
 * Emite los items en orden, de a uno, y corta en el primero que falla: en un lote, con un `BatchEmissionError` que dice
 * cual y cuales faltan; uno suelto, con su propio error.
 */
export async function emitBatch<T, R>(options: {
  readonly emit: (input: T, position: number) => Promise<R>;
  readonly inputs: readonly T[];
  readonly plan: Omit<BatchPlan, 'invalidItems'>;
}): Promise<EmissionOutcome<R>> {
  const { emit, inputs, plan } = options;
  const results: R[] = [];

  for (const [position, input] of inputs.entries()) {
    try {
      results.push(await emit(input, position));
    } catch (error) {
      if (!plan.isBatch) {
        return { error, results };
      }

      return {
        error: new BatchEmissionError({
          cause: error,
          emitted: results.length,
          failedIndex: plan.inputIndexes[position] ?? position + 1,
          total: plan.total,
        }),
        results,
      };
    }
  }

  return { results };
}

/** Avisa lo que respondio ARCA. Si el aviso falla, el comprobante ya esta emitido: no puede verse como no emitido. */
export function notifyEmitted<R>(onEmitted: ((result: R) => void) | undefined, result: R): R {
  try {
    onEmitted?.(result);
  } catch {
    // El resultado llega igual en `results`.
  }

  return result;
}
