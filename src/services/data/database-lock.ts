import { closeSync, openSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

import { LocalDataError } from '../../modules/local-data/local-data-error';

/**
 * El turno para cambiar qué archivo es la base (ARQ-12 PR 4b): crearla, apartar una dañada y reponerla, o restaurar
 * una copia. Es un archivo vacío al lado de la base (`.bloqueo-comprobantes.db`) creado con `wx`: lo tiene uno solo.
 * Así dos procesos que encuentran la base dañada a la vez no la apartan dos veces, y uno que la encuentra sin base
 * no crea una vacía mientras otro está reponiendo la de la copia. Guardar y leer no lo piden: eso lo ordena SQLite.
 */

/** Uno de más de esto es de un proceso que murió con el turno: crear o reponer una base tarda mucho menos. */
const STALE_LOCK_MS = 30_000;
/** La espera del turno: más que `STALE_LOCK_MS`, así uno que quedó de un proceso muerto se toma antes de rendirse. */
const LOCK_WAIT_MS = 40_000;
const LOCK_POLL_MS = 50;

function lockPath(file: string): string {
  return join(dirname(file), `.bloqueo-${basename(file)}`);
}

function isStale(lock: string): boolean {
  try {
    return Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS;
  } catch {
    // Lo soltó el otro mientras se miraba: se vuelve a probar enseguida.
    return true;
  }
}

/** Suelta sin fallar: no poder borrarlo (un antivirus en Windows) no hace fallar lo que ya se hizo. */
function release(lock: string): void {
  try {
    rmSync(lock, { force: true, maxRetries: 3 });
  } catch {
    // Queda hasta que se vuelva viejo (`STALE_LOCK_MS`).
  }
}

/**
 * Corre `work` con el turno de la base. Si lo tiene otro, espera (sin bloquear el proceso) hasta que lo suelte; uno
 * viejo se toma. Si no llega, `LocalDataError('locked')`. Otro error al pedirlo (carpeta de solo lectura) sale como
 * vino: lo clasifica quien llama.
 */
export async function withDatabaseLock<T>(file: string, work: () => Promise<T> | T): Promise<T> {
  const lock = lockPath(file);

  for (const deadline = Date.now() + LOCK_WAIT_MS; ;) {
    try {
      closeSync(openSync(lock, 'wx', 0o600));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }

    if (isStale(lock)) {
      release(lock);
    } else if (Date.now() > deadline) {
      throw new LocalDataError('locked', `Otro proceso está creando o reponiendo ${file}.`);
    } else {
      await pause(LOCK_POLL_MS);
    }
  }

  try {
    return await work();
  } finally {
    release(lock);
  }
}
