export class AppError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  public constructor(message: string, options: { code: string; details?: Record<string, unknown> }) {
    super(message);
    this.name = 'AppError';
    this.code = options.code;
    this.details = options.details;
  }
}

export class ConfigurationError extends AppError {
  public constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      code: 'CONFIGURATION_ERROR',
      details,
    });
    this.name = 'ConfigurationError';
  }
}

export class InputValidationError extends AppError {
  public constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      code: 'INPUT_VALIDATION_ERROR',
      details,
    });
    this.name = 'InputValidationError';
  }
}
