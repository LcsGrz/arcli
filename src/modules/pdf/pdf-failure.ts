import { AppError } from '../../lib/errors/app-error';
import { describeFileError } from '../../lib/files/file-error';

import { PdfError } from './pdf.errors';
import type { PdfOutcome } from './pdf.types';

export function toPdfFailure(error: unknown): Extract<PdfOutcome, { error: unknown }> {
  if (error instanceof PdfError) {
    return { error: { code: error.code, message: error.message, suggestion: error.suggestion } };
  }

  if (error instanceof AppError) {
    return { error: { code: error.code, message: error.message } };
  }

  const fileError = describeFileError(error);

  if (fileError) {
    return { error: { code: 'PDF_GENERATION_ERROR', ...fileError } };
  }

  return {
    error: { code: 'PDF_GENERATION_ERROR', message: error instanceof Error ? error.message : String(error) },
  };
}
