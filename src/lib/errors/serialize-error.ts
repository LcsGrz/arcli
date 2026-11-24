import { errorText } from '../files/file-error';

import { AppError, InputIssuesError } from './app-error';
import type { ErrorCode } from './error-codes';
import { summarizeError } from './error-summary';
import type { InputIssue } from './input-issue';

/** Un error, con la forma del `--json`: es contrato, tambien el orden de las claves. */
export type SerializedError = {
  readonly codigo: ErrorCode;
  readonly detalles: Readonly<Record<string, unknown>> | ReadonlyArray<Omit<InputIssue, 'label'>> | null;
  readonly error: string;
  /** Siempre presente: `null` cuando no hay que sugerir. */
  readonly sugerencia: string | null;
};

function serializeDetails(error: unknown): SerializedError['detalles'] {
  if (error instanceof InputIssuesError) {
    return error.issues.map(({ mensaje, ruta }) => ({ mensaje, ruta }));
  }

  if (!(error instanceof AppError) || !error.details) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(error.details)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => [key === 'path' ? 'ruta' : key, value]),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? errorText(error) : 'Ocurrió un error inesperado.';
}

/** Cualquier error, como dato. Los de un esquema (zod) llegan ya descriptos: ver `describeSchemaError`. */
export function serializeError(error: unknown): SerializedError {
  const { code, suggestion } = summarizeError(error);

  return {
    codigo: code,
    detalles: serializeDetails(error),
    error: errorMessage(error),
    sugerencia: suggestion,
  };
}
