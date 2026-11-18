import type { InputIssue } from './input-issue';

export const HELP_SUGGESTION = 'Usá `arcli ayuda` o `arcli <comando> --ayuda` para ver comandos y opciones.';

export class AppError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;
  /** Que hacer ahora; sale como "Sugerencia" en texto y `sugerencia` en JSON. */
  public readonly suggestion?: string;

  public constructor(
    message: string,
    options: { code: string; details?: Record<string, unknown>; suggestion?: string },
  ) {
    super(message);
    this.name = 'AppError';
    this.code = options.code;
    this.details = options.details;
    this.suggestion = options.suggestion;
  }
}

/**
 * Un error de entrada con el mensaje y la sugerencia del dominio y, en `issues`, los problemas del esquema tal como
 * salian antes en `detalles` del `--json`: el texto puede mejorar sin cambiar esa forma, que es contrato.
 */
export class InputIssuesError extends AppError {
  public readonly issues: readonly InputIssue[];

  public constructor(message: string, issues: readonly InputIssue[], suggestion?: string) {
    super(message, { code: 'INPUT_VALIDATION_ERROR', suggestion });
    this.name = 'InputIssuesError';
    this.issues = issues;
  }
}

export class ConfigurationError extends AppError {
  public constructor(message: string, details?: Record<string, unknown>, suggestion?: string) {
    super(message, {
      code: 'CONFIGURATION_ERROR',
      details,
      suggestion,
    });
    this.name = 'ConfigurationError';
  }
}

export class InputValidationError extends AppError {
  public constructor(message: string, details?: Record<string, unknown>, suggestion?: string) {
    super(message, {
      code: 'INPUT_VALIDATION_ERROR',
      details,
      suggestion,
    });
    this.name = 'InputValidationError';
  }
}
