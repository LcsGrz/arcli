import { CANCELLED_NOTICE } from './emission-texts';

/** Ctrl+C en "¿Emitimos?" de un comando: se cancelo antes de emitir, asi que se puede decir. */
export class EmissionCancelledError extends Error {
  public constructor() {
    super(CANCELLED_NOTICE);
    this.name = 'EmissionCancelledError';
  }
}
