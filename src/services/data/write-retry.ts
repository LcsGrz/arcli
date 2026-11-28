import { setTimeout } from 'node:timers/promises';

import { LocalDataError } from '../../modules/local-data/local-data-error';

import { tiempo } from './tiempos';

/** Intentos de una unidad de escritura cuando la base está tomada por otro proceso. */
export const WRITE_ATTEMPTS = 3;

/**
 * La pausa entre intentos, al azar en este rango (ms). Sin ella, los procesos que esperan vuelven a pedir la base todos
 * juntos y uno puede perder siempre (Windows, CI del 26/11: un guardado de 8 procesos × 100 salió `locked` tras los 3).
 */
export const RETRY_PAUSE_MS = { max: 300, min: 50 } as const;

export interface WriteRetryOptions {
  /** La espera; en los tests, sin esperar de verdad. */
  readonly pause?: (ms: number) => Promise<unknown>;
  /** De 0 (incluido) a 1 (excluido), como `Math.random`. */
  readonly random?: () => number;
}

/**
 * Corre la unidad de escritura entera y, si falla con `LocalDataError('locked')`, la vuelve a correr, hasta
 * `WRITE_ATTEMPTS` veces. Cualquier otro error sale enseguida. Cada intento ya esperó hasta 5 s por sentencia en el driver, de a
 * vueltas cortas (`BUSY_SLICE_MS`, ARQ-30); entre uno y otro hay además una pausa al azar (`RETRY_PAUSE_MS`), sin bloquear el proceso, para que los que esperan
 * no vuelvan a la vez. Es solo para la base local: una emisión a ARCA nunca se reintenta así.
 */
export async function withWriteRetry<T>(
  unit: () => Promise<T> | T,
  { pause = setTimeout, random = Math.random }: WriteRetryOptions = {},
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await tiempo(`withWriteRetry intento ${attempt}`, unit);
    } catch (error) {
      if (attempt >= WRITE_ATTEMPTS || !(error instanceof LocalDataError) || error.reason !== 'locked') {
        throw error;
      }
    }

    await pause(Math.round(RETRY_PAUSE_MS.min + random() * (RETRY_PAUSE_MS.max - RETRY_PAUSE_MS.min)));
  }
}
