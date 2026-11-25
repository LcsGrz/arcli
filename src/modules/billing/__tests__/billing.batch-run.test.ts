import { describe, expect, it, vi } from 'vitest';

import { InputValidationError } from '../../../lib/errors/app-error';
import { BatchEmissionError, type BatchItemError, BatchValidationError } from '../billing.batch';
import { type EmissionOutcome, emitBatch, prepareBatch } from '../billing.batch-run';
import { EmissionUncertainError } from '../billing.errors';

const batch = (total: number, invalidItems: BatchItemError[] = []) => ({
  inputIndexes: Array.from({ length: total - invalidItems.length }, (_, position) => position + 1),
  invalidItems,
  isBatch: total > 1,
  total,
});
const oneItemBatch = { inputIndexes: [1], invalidItems: [], isBatch: true, total: 1 };

describe('prepareBatch', () => {
  it('con un solo comprobante deja pasar el error de la consulta como siempre', async () => {
    const original = new Error('El padrón no responde');

    await expect(
      prepareBatch({
        inputs: ['a'],
        plan: batch(1),
        resolve: async () => {
          throw original;
        },
      }),
    ).rejects.toBe(original);
  });

  it('junta los fallos de las consultas con los de validacion, con su indice, sin cortar en el primero', async () => {
    const plan = {
      inputIndexes: [1, 2, 4, 5],
      invalidItems: [{ code: 'INPUT_VALIDATION_ERROR' as const, index: 3, message: 'Falta monto.', suggestion: null }],
      isBatch: true,
      total: 5,
    };
    const resolve = vi.fn(async (input: string) => {
      if (input === 'sin-cotizacion') {
        throw new Error('ARCA no devolvió la cotización de DOL.');
      }

      if (input === 'invalido') {
        throw new InputValidationError('La factura A no admite IVA receptor "consumidor-final".');
      }

      return `${input}-resuelto`;
    });

    const run = prepareBatch({ inputs: ['ok', 'sin-cotizacion', 'invalido', 'ok'], plan, resolve });

    await expect(run).rejects.toThrow(BatchValidationError);
    await run.catch((error: BatchValidationError) => {
      expect(error.message).toContain('3 de 5 comprobantes del lote tienen errores. No se emitió ninguno.');
      expect(error.message).toContain('#2: ARCA no devolvió la cotización de DOL.');
      expect(error.details).toEqual({
        comprobantes: [
          { codigo: 'UNEXPECTED_ERROR', error: 'ARCA no devolvió la cotización de DOL.', indice: 2, sugerencia: null },
          { codigo: 'INPUT_VALIDATION_ERROR', error: 'Falta monto.', indice: 3, sugerencia: null },
          {
            codigo: 'INPUT_VALIDATION_ERROR',
            error: 'La factura A no admite IVA receptor "consumidor-final".',
            indice: 4,
            sugerencia: null,
          },
        ],
      });
    });
    expect(resolve).toHaveBeenCalledTimes(4);
  });

  it('devuelve lo resuelto, en orden, si todo es valido', async () => {
    await expect(
      prepareBatch({
        inputs: ['a', 'b'],
        plan: batch(2),
        resolve: async (input: string, index) => `${index} ${input}`,
      }),
    ).resolves.toEqual(['1 a', '2 b']);
  });
  it('en un lote de un solo comprobante informa el fallo con su indice', async () => {
    const run = prepareBatch({
      inputs: ['a'],
      plan: oneItemBatch,
      resolve: async () => {
        throw new Error('El padrón no responde');
      },
    });

    await expect(run).rejects.toThrow(BatchValidationError);
    await expect(run).rejects.toMatchObject({
      details: {
        comprobantes: [{ codigo: 'UNEXPECTED_ERROR', error: 'El padrón no responde', indice: 1, sugerencia: null }],
      },
    });
  });
});

interface Item {
  readonly index: number;
  readonly input: string;
}

const items = (inputs: readonly string[]): Item[] => inputs.map((input, position) => ({ index: position + 1, input }));

/** El error de un lote cortado, que tiene que ser el del lote. */
function batchError(outcome: EmissionOutcome<string>): BatchEmissionError {
  const error = 'error' in outcome ? outcome.error : undefined;

  if (!(error instanceof BatchEmissionError)) {
    throw new Error('el lote no se cortó');
  }

  return error;
}

describe('emitBatch', () => {
  it('emite todo en orden', async () => {
    const outcome = await emitBatch({
      emit: async ({ input }: Item) => `CAE-${input}`,
      items: items(['a', 'b']),
      scope: batch(2),
    });

    expect(outcome).toEqual({ results: ['CAE-a', 'CAE-b'] });
  });

  it('si falla a mitad antes de emitir, entrega lo ya procesado y deja el que fallo para reintentar', async () => {
    const emit = vi.fn(async ({ input }: Item) => {
      if (input === 'c') {
        throw new Error('Transacción Activa');
      }

      return `CAE-${input}`;
    });
    const outcome = await emitBatch({ emit, items: items(['a', 'b', 'c', 'd']), scope: batch(4) });
    const error = batchError(outcome);

    expect(error.message).toContain('El lote se interrumpió en el comprobante #3: Transacción Activa');
    expect(error.message).toContain('Procesados: 2 de 4.\nSin procesar: #3, #4.');
    expect(error.details).toEqual({
      codigoCausa: 'TRANSIENT_ERROR',
      fallo: 3,
      procesados: 2,
      sinProcesar: [3, 4],
      total: 4,
    });
    expect(outcome.results).toEqual(['CAE-a', 'CAE-b']);
    expect(emit).toHaveBeenCalledTimes(3);
  });

  it('el indice del que fallo es el del archivo, no el de los que se leyeron', async () => {
    const outcome = await emitBatch({
      emit: async (): Promise<string> => {
        throw new Error('boom');
      },
      items: [{ index: 3, input: 'a' }],
      scope: { isBatch: true, total: 4 },
    });

    expect(batchError(outcome).details).toMatchObject({ fallo: 3, procesados: 0, sinProcesar: [3, 4] });
  });

  it('si la emision quedo sin confirmar, pide verificar el que fallo', async () => {
    const cause = new EmissionUncertainError({
      arcaType: 11,
      cause: new Error('timeout'),
      environment: 'produccion',
      pointOfSale: 3,
      shortcut: 'fc',
      voucherNumber: 42,
    });
    const outcome = await emitBatch({
      emit: async ({ input }: Item) => {
        if (input === 'b') {
          throw cause;
        }

        return `CAE-${input}`;
      },
      items: items(['a', 'b', 'c']),
      scope: batch(3),
    });
    const error = batchError(outcome);

    expect(error.message).toContain('El #2 puede haberse emitido');
    expect(error.message).toContain('`arcli ultimos fc --pv 3 --produccion`');
    expect(error.details).toMatchObject({ fallo: 2, numero: 42, sinConfirmar: 2, sinProcesar: [3] });
  });

  it('en un lote de un solo comprobante corta con BATCH_EMISSION_ERROR', async () => {
    const outcome = await emitBatch({
      emit: async (): Promise<string> => {
        throw new Error('boom');
      },
      items: items(['a']),
      scope: oneItemBatch,
    });

    expect(batchError(outcome)).toBeInstanceOf(BatchEmissionError);
  });

  it('con un solo comprobante deja pasar el error original', async () => {
    const original = new Error('boom');

    await expect(
      emitBatch({
        emit: async () => {
          throw original;
        },
        items: items(['a']),
        scope: batch(1),
      }),
    ).resolves.toEqual({ error: original, results: [] });
  });
});
