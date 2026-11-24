import { ZodError } from 'zod';

import { AppError } from '../../lib/errors/app-error';
import { summarizeError } from '../../lib/errors/error-summary';

import { EmissionUncertainError } from './billing.errors';
import { summarizeZodError } from './billing.zod-errors';

export interface BatchItemError {
  /** El `codigo` que daria ese comprobante solo. */
  readonly code: string;
  /** Posicion en el lote, empezando en 1. */
  readonly index: number;
  readonly message: string;
  /** La `sugerencia` que daria ese comprobante solo. */
  readonly suggestion: string | null;
}

function describeBatchItemError(error: unknown): string {
  if (error instanceof ZodError) {
    return summarizeZodError(error);
  }

  return error instanceof Error ? error.message : String(error);
}

/** El error de un comprobante del lote; `index` es su posicion, empezando en 1. */
export function toBatchItemError(index: number, error: unknown): BatchItemError {
  const { code, suggestion } = summarizeError(error);

  return { code, index, message: describeBatchItemError(error), suggestion };
}

/** Uno o mas comprobantes del lote no pasan la validacion. Se detecta antes de emitir: no se emitio ninguno. */
export class BatchValidationError extends AppError {
  public constructor(errors: readonly BatchItemError[], total: number) {
    const lines = errors.map((item) => `#${item.index}: ${item.message}`);

    super(
      [
        errors.length === 1
          ? `1 de ${total} ${total === 1 ? 'comprobante' : 'comprobantes'} del lote tiene errores. No se emitió ninguno.`
          : `${errors.length} de ${total} comprobantes del lote tienen errores. No se emitió ninguno.`,
        '',
        ...lines,
      ].join('\n'),
      {
        code: 'BATCH_VALIDATION_ERROR',
        details: {
          comprobantes: errors.map((item) => ({
            codigo: item.code,
            error: item.message,
            indice: item.index,
            sugerencia: item.suggestion,
          })),
        },
      },
    );
    this.name = 'BatchValidationError';
  }
}

/**
 * La emision se corto a mitad del lote (red, ARCA). Los resultados ya emitidos se imprimen antes que este
 * error, para que nadie los vuelva a cargar y los duplique.
 */
export class BatchEmissionError extends AppError {
  public constructor(options: {
    readonly cause: unknown;
    readonly emitted: number;
    readonly failedIndex: number;
    readonly total: number;
  }) {
    const uncertain = options.cause instanceof EmissionUncertainError;
    // Si el fallo fue antes de la llamada que emite (login, ultimo numero), ese comprobante tampoco se proceso.
    const firstPending = uncertain ? options.failedIndex + 1 : options.failedIndex;
    const pending = Array.from({ length: options.total - firstPending + 1 }, (_, offset) => firstPending + offset);

    super(
      [
        `El lote se interrumpió en el comprobante #${options.failedIndex}: ${describeBatchItemError(options.cause)}`,
        `Procesados: ${options.emitted} de ${options.total}.${pending.length > 0 ? ` Sin procesar: ${pending.map((index) => `#${index}`).join(', ')}.` : ''}`,
        ...(uncertain
          ? [
              `El #${options.failedIndex} puede haberse emitido: verificalo con \`${(options.cause as EmissionUncertainError).verifyCommand ?? 'arcli ultimos'}\` antes de reintentarlo.`,
            ]
          : []),
      ].join('\n'),
      {
        code: 'BATCH_EMISSION_ERROR',
        details: {
          procesados: options.emitted,
          fallo: options.failedIndex,
          sinProcesar: pending,
          ...(uncertain ? { sinConfirmar: options.failedIndex } : {}),
          total: options.total,
        },
      },
    );
    this.name = 'BatchEmissionError';
  }
}
