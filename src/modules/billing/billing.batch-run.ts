import { BatchEmissionError, type BatchItemError, BatchValidationError, toBatchItemError } from './billing.batch';
import { EmissionUncertainError, type SentVoucher } from './billing.errors';
import {
  ABANDONED_REASON,
  type BeforeSending,
  type EmissionInterruption,
  EmissionStoppedError,
} from './emission-interruption';

/** Si es un lote y de cuantos: lo que hace falta al emitir. */
export interface BatchScope {
  /** Entro un array: se trata como lote aunque tenga un solo item. */
  readonly isBatch: boolean;
  readonly total: number;
}

/** Lo que hace falta de un plan para informar cada fallo con su lugar en el lote. */
export interface BatchPlan extends BatchScope {
  /** La posicion en el lote, desde 1, de cada item que se pudo leer. */
  readonly inputIndexes: readonly number[];
  readonly invalidItems: readonly BatchItemError[];
}

/**
 * Prepara un lote antes de emitir: `resolve` completa cada item con lo que hay que consultar en ARCA (IVA receptor del
 * padron, cotizacion) y le aplica las reglas de negocio. En un lote no corta en el primer fallo: junta todos, con su
 * indice, en un solo `BatchValidationError`, y no se emite ninguno. Con un comprobante suelto (no un array) el error
 * sale tal cual, como siempre.
 */
export async function prepareBatch<T, R>(options: {
  readonly inputs: readonly T[];
  readonly plan: BatchPlan;
  readonly resolve: (input: T, index: number) => Promise<R>;
}): Promise<R[]> {
  const { inputs, plan, resolve } = options;
  const resolved: R[] = [];
  const errors: BatchItemError[] = [...plan.invalidItems];

  // Secuencial a proposito: cada servicio de ARCA reutiliza su ticket WSAA.
  for (const [position, input] of inputs.entries()) {
    const index = plan.inputIndexes[position];

    // `resolveBillingInputPlan` arma `inputs` e `inputIndexes` juntos, uno por item: siempre hay posicion.
    if (index === undefined) {
      throw new Error(`El plan del lote no tiene la posición del item ${position + 1}.`);
    }

    try {
      resolved.push(await resolve(input, index));
    } catch (error) {
      if (!plan.isBatch) {
        throw error;
      }

      errors.push(toBatchItemError(index, error));
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

const GIVEN_UP = Symbol('se dejo de esperar');

/**
 * Emite los items en orden, de a uno, y corta en el primero que falla: en un lote, con un `BatchEmissionError` que dice
 * cual y cuales faltan; uno suelto, con su propio error. `index` es el lugar de cada uno en el lote, desde 1.
 *
 * Lo que se deja de esperar (`abandoned`) no se envia despues ni llama a `onAnswered`, aunque ARCA conteste tarde.
 */
export async function emitBatch<T extends { readonly index: number }, R>(options: {
  /** Tiene que llamar a `beforeSending` justo antes de la llamada que emite. */
  readonly emit: (item: T, position: number, beforeSending: BeforeSending) => Promise<R>;
  readonly interruption?: EmissionInterruption;
  /** Si ese resultado tiene CAE. */
  readonly isIssued?: (result: R) => boolean;
  readonly items: readonly T[];
  /** Cada resultado, antes de seguir con el proximo. */
  readonly onAnswered?: (item: T, result: R, position: number) => Promise<unknown>;
  readonly scope: BatchScope;
}): Promise<EmissionOutcome<R>> {
  const { emit, interruption = {}, isIssued, items, onAnswered, scope } = options;
  const results: R[] = [];
  /** La posicion en el lote de cada resultado con CAE, en orden. */
  const issued: number[] = [];
  let hasGivenUp = false;
  const givenUp = interruption.abandoned?.then((): typeof GIVEN_UP => {
    hasGivenUp = true;

    return GIVEN_UP;
  });

  function assertNotStopped(): void {
    if (hasGivenUp || interruption.shouldStop?.()) {
      throw new EmissionStoppedError();
    }
  }

  /** Corre un item y, si se abandona, deja de esperarlo. */
  async function emitOrGiveUp(item: T, position: number): Promise<R> {
    const sent: SentVoucher[] = [];

    assertNotStopped();

    const emission = emit(item, position, (voucher) => {
      assertNotStopped();
      interruption.onSending?.(voucher);
      sent.push(voucher);
    });
    const result = await (givenUp ? Promise.race([emission, givenUp]) : emission);

    if (result !== GIVEN_UP) {
      return result as R;
    }

    const [inFlight] = sent;

    throw inFlight
      ? new EmissionUncertainError({ ...inFlight, cause: new Error(ABANDONED_REASON) })
      : new EmissionStoppedError();
  }

  for (const [position, item] of items.entries()) {
    try {
      const result = await emitOrGiveUp(item, position);

      results.push(result);

      if (isIssued?.(result)) {
        issued.push(item.index);
      }

      await onAnswered?.(item, result, position);
    } catch (error) {
      if (!scope.isBatch) {
        return { error, results };
      }

      return {
        error: new BatchEmissionError({
          cause: error,
          emitted: results.length,
          failedIndex: item.index,
          stopped:
            hasGivenUp || error instanceof EmissionStoppedError
              ? {
                  issued,
                  message: interruption.stopMessage?.() ?? 'Se cortó el lote.',
                }
              : undefined,
          total: scope.total,
        }),
        results,
      };
    }
  }

  return { results };
}

/**
 * El aviso de cada respuesta de ARCA, con su posicion en la lista que se emite (desde 0). Se espera antes de seguir con
 * el proximo. Si falla, al llamarlo o despues, se ignora: el comprobante ya esta emitido y su resultado llega igual en
 * `results`, asi que no corta el lote ni puede verse como no emitido. Quien necesite saber que fallo lo anota adentro.
 */
export type OnEmitted<R> = (result: R, position: number) => Promise<void> | void;

export async function notifyEmitted<R>(onEmitted: OnEmitted<R> | undefined, result: R, position: number): Promise<R> {
  try {
    await onEmitted?.(result, position);
  } catch {
    // Ver OnEmitted.
  }

  return result;
}
