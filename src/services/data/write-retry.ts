/** Intentos de una unidad de escritura cuando la base está tomada por otro proceso. */
export const WRITE_ATTEMPTS = 3;

/**
 * Corre la unidad de escritura entera y, si falla con `LocalDataError('locked')`, la vuelve a correr, hasta
 * `WRITE_ATTEMPTS` veces. Cualquier otro error sale enseguida.
 *
 * @internal Stub de Tests primero (ARQ-12 PR 4a): lo implementa nucleo.
 */
export function withWriteRetry<T>(_unit: () => T): T {
  throw new Error('no implementado: stub de Tests primero (ARQ-12 PR 4a), lo implementa nucleo');
}
