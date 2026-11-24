import { AppError } from '../../lib/errors/app-error';
import type { ErrorCode } from '../../lib/errors/error-codes';

export type PdfErrorCode = Extract<ErrorCode, `PDF_${string}`>;

export class PdfError extends AppError {
  public constructor(
    code: PdfErrorCode,
    message: string,
    options: { readonly details?: Record<string, unknown>; readonly suggestion?: string } = {},
  ) {
    super(message, { code, details: options.details, suggestion: options.suggestion });
    this.name = 'PdfError';
  }
}

export const PDF_INSTALL_SUGGESTION = 'Instalalo con `arcli pdf instalar`.';
