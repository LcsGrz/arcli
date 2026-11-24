import { CommanderError } from 'commander';

/** Un error de uso de commander con una sugerencia propia, en vez de la de la ayuda. */
export class UsageErrorWithSuggestion extends CommanderError {
  public constructor(
    code: string,
    message: string,
    public readonly suggestion: string,
  ) {
    super(1, code, message);
  }
}
