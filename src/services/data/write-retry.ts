import { LocalDataError } from '../../modules/local-data/local-data-error';

/** Intentos de una unidad de escritura cuando la base está tomada por otro proceso. */
export const WRITE_ATTEMPTS = 3;

/**
 * Corre la unidad de escritura entera y, si falla con `LocalDataError('locked')`, la vuelve a correr, hasta
 * `WRITE_ATTEMPTS` veces. Cualquier otro error sale enseguida. No espera entre intentos: cada uno ya esperó el
 * `busy_timeout` de SQLite. Es solo para la base local: una emisión a ARCA nunca se reintenta así.
 */
export function withWriteRetry<T>(unit: () => T): T {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return unit();
    } catch (error) {
      if (attempt >= WRITE_ATTEMPTS || !(error instanceof LocalDataError) || error.reason !== 'locked') {
        throw error;
      }
    }
  }
}
