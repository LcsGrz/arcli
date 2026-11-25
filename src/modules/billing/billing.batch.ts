import { ZodError } from 'zod';

import { AppError } from '../../lib/errors/app-error';
import type { ErrorCode } from '../../lib/errors/error-codes';
import { causeCodeOf, causeDetails, summarizeError } from '../../lib/errors/error-summary';
import { errorText } from '../../lib/files/file-error';
import { joinWithAnd } from '../../lib/text/join-with-and';

import { EmissionUncertainError } from './billing.errors';
import { summarizeZodError } from './billing.zod-errors';

export interface BatchItemError {
  /** El `detalles.codigoCausa` que daria ese comprobante solo, si lo trae. */
  readonly causeCode?: ErrorCode;
  /** El `codigo` que daria ese comprobante solo. */
  readonly code: ErrorCode;
  /** Posicion en el lote, empezando en 1. */
  readonly index: number;
  readonly message: string;
  /** La `sugerencia` que daria ese comprobante solo. */
  readonly suggestion: string | null;
}

function describeBatchItemError(error: unknown): string {
  return error instanceof ZodError ? summarizeZodError(error) : errorText(error);
}

/** El error de un comprobante del lote; `index` es su posicion, empezando en 1. */
export function toBatchItemError(index: number, error: unknown): BatchItemError {
  const { code, suggestion } = summarizeError(error);

  const causeCode = causeCodeOf(error);

  return { ...(causeCode && { causeCode }), code, index, message: describeBatchItemError(error), suggestion };
}

/** Las claves de `detalles` del `--json`: son contrato. */
type BatchValidationDetails = {
  readonly comprobantes: ReadonlyArray<{
    readonly codigo: ErrorCode;
    readonly error: string;
    readonly indice: number;
    readonly sugerencia: string | null;
    readonly codigoCausa?: ErrorCode;
  }>;
};

/** Uno o mas comprobantes del lote no pasan la validacion. Se detecta antes de emitir: no se emitio ninguno. */
export class BatchValidationError extends AppError {
  declare public readonly details: BatchValidationDetails;

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
            ...(item.causeCode && { codigoCausa: item.causeCode }),
          })),
        } satisfies BatchValidationDetails,
      },
    );
    this.name = 'BatchValidationError';
  }
}

/** Las claves de `detalles` del `--json`: son contrato. */
type BatchEmissionDetails = {
  readonly procesados: number;
  readonly fallo: number;
  readonly sinProcesar: readonly number[];
  /** Solo si el que fallo puede haberse emitido. */
  readonly sinConfirmar?: number;
  /** El numero del que quedo sin confirmar: solo con `sinConfirmar`. */
  readonly numero?: number;
  readonly total: number;
  /** El `codigo` que daria solo el comprobante que fallo; `CANCELLED` si se corto antes de enviarlo. */
  readonly codigoCausa: ErrorCode;
};

/** Los seguidos juntos: de tres en adelante, el rango (`#3 a #5`). */
function formatIndexRuns(indexes: readonly number[]): string[] {
  const runs: number[][] = [];

  for (const index of indexes) {
    const run = runs.at(-1);

    if (run?.at(-1) === index - 1) {
      run.push(index);
    } else {
      runs.push([index]);
    }
  }

  return runs.flatMap((run) =>
    run.length < 3 ? run.map((index) => `#${index}`) : [`#${run[0]} a #${run[run.length - 1]}`],
  );
}

/** Con un rango, tambien la cantidad. */
function formatCount(indexes: readonly number[], labels: readonly string[]): string {
  return labels.length < indexes.length ? ` (${indexes.length})` : '';
}

/** Los que quedaron sin procesar, que son siempre los ultimos. */
function describePending(pending: readonly number[]): string[] {
  const labels = formatIndexRuns(pending);

  return labels.length > 0 ? [`Sin procesar: ${labels.join(', ')}${formatCount(pending, labels)}.`] : [];
}

/** Los que tienen CAE, en un lote que corto quien lo corrio. */
function describeIssued(issued: readonly number[]): string[] {
  const labels = formatIndexRuns(issued);

  return labels.length > 0
    ? [`Ya se ${issued.length === 1 ? 'emitió' : 'emitieron'}: ${joinWithAnd(labels)}${formatCount(issued, labels)}.`]
    : [];
}

/**
 * Que hacer con un lote cortado. Los procesados pueden incluir rechazados, que no se emitieron: manda el CAE. Sin uno
 * sin confirmar, fallo antes de la llamada que emite (ERR-16): la sugerencia de la causa no se copia, porque habla de
 * un comprobante solo.
 */
function describeNextSteps(batch: {
  /** Los procesados o, si se sabe, solo los que tienen CAE. */
  readonly emitted: number;
  readonly pending: readonly number[];
  readonly uncertainIndex?: number;
}): string {
  const emitted = 'Los procesados con CAE ya se emitieron: recordá no volver a cargarlos.';

  if (batch.uncertainIndex !== undefined) {
    return [
      ...(batch.emitted > 0 ? [emitted] : []),
      `Verificá el #${batch.uncertainIndex} antes de reintentarlo.`,
      ...(batch.pending.length > 0 ? ['Después reintentá únicamente los que quedaron sin procesar.'] : []),
    ].join(' ');
  }

  return batch.emitted > 0
    ? `${emitted} El resto no se emitió: reintentá únicamente los que quedaron sin procesar.`
    : 'No se emitió ninguno: podés reintentar los que quedaron sin procesar.';
}

/**
 * La emision se corto a mitad del lote (red, ARCA). Los resultados ya emitidos se imprimen antes que este
 * error, para que nadie los vuelva a cargar y los duplique.
 */
export class BatchEmissionError extends AppError {
  declare public readonly details: BatchEmissionDetails;

  public constructor(options: {
    readonly cause: unknown;
    readonly emitted: number;
    readonly failedIndex: number;
    /** Lo corto quien lo corrio y no un fallo: como se dice y los indices que tienen CAE. */
    readonly stopped?: { readonly issued: readonly number[]; readonly message: string };
    readonly total: number;
  }) {
    const { stopped } = options;
    const uncertain = options.cause instanceof EmissionUncertainError ? options.cause : undefined;
    // Si el fallo fue antes de la llamada que emite (login, ultimo numero), ese comprobante tampoco se proceso.
    const firstPending = uncertain ? options.failedIndex + 1 : options.failedIndex;
    const pending = Array.from({ length: options.total - firstPending + 1 }, (_, offset) => firstPending + offset);

    super(
      [
        ...(stopped
          ? [stopped.message, ...describeIssued(stopped.issued)]
          : [
              `El lote se interrumpió en el comprobante #${options.failedIndex}: ${describeBatchItemError(options.cause)}`,
            ]),
        `Procesados: ${options.emitted} de ${options.total}.`,
        ...describePending(pending),
        ...(uncertain
          ? [
              `El #${options.failedIndex} puede haberse emitido: verificalo con \`${uncertain.verifyCommand}\` antes de reintentarlo.`,
            ]
          : []),
      ].join('\n'),
      {
        code: 'BATCH_EMISSION_ERROR',
        details: {
          procesados: options.emitted,
          fallo: options.failedIndex,
          sinProcesar: pending,
          ...(uncertain ? { sinConfirmar: options.failedIndex, numero: uncertain.details.numero } : {}),
          total: options.total,
          ...causeDetails(options.cause),
        } satisfies BatchEmissionDetails,
        suggestion: describeNextSteps({
          emitted: stopped ? stopped.issued.length : options.emitted,
          pending,
          uncertainIndex: uncertain ? options.failedIndex : undefined,
        }),
      },
    );
    this.name = 'BatchEmissionError';
  }
}
