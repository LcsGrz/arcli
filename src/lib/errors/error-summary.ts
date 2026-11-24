import { ZodError } from 'zod';

import { describeFileError } from '../files/file-error';

import { AppError } from './app-error';
import { isQueryError, VERIFY_BEFORE_RETRY } from './query-error';

export interface ErrorSummary {
  /** El `codigo` del `--json`. */
  readonly code: string;
  /** La `sugerencia` del `--json`; `null` si no hay nada que sugerir. */
  readonly suggestion: string | null;
  /** De donde es el estado pasajero, en un `TRANSIENT_ERROR`. */
  readonly transient?: 'arca' | 'wsaa';
}

function detectTransientError(
  message: string,
  query: boolean,
): { readonly suggestion: string; readonly transient: 'arca' | 'wsaa' } | null {
  if (message.includes('coe.alreadyAuthenticated')) {
    return {
      suggestion: `ARCA todavía tiene abierta una sesión anterior. Esperá un par de minutos y ${query ? `repetí la consulta. ${VERIFY_BEFORE_RETRY}` : 'probá de nuevo, con los mismos datos.'}`,
      transient: 'wsaa',
    };
  }

  if (message.includes('Transacción Activa')) {
    return {
      suggestion: `ARCA devolvió una transacción activa. Esperá unos segundos y ${query ? `repetí la consulta. ${VERIFY_BEFORE_RETRY}` : 'reintentá la emisión antes de modificar datos del comprobante.'}`,
      transient: 'arca',
    };
  }

  return null;
}

/**
 * El `codigo` y la `sugerencia` de cualquier error, con los mismos valores que su `--json`: los usan el presenter, los
 * items de un lote y `codigoCausa`.
 */
export function summarizeError(error: unknown): ErrorSummary {
  if (error instanceof AppError) {
    return { code: error.code, suggestion: error.suggestion ?? null };
  }

  if (error instanceof ZodError) {
    return { code: 'INPUT_VALIDATION_ERROR', suggestion: null };
  }

  const fileError = describeFileError(error);

  if (fileError) {
    return { code: 'UNEXPECTED_ERROR', suggestion: fileError.suggestion };
  }

  const transient = error instanceof Error ? detectTransientError(error.message, isQueryError(error)) : null;

  return transient ? { code: 'TRANSIENT_ERROR', ...transient } : { code: 'UNEXPECTED_ERROR', suggestion: null };
}
