import { closeSync, fchmodSync, openSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';

import { LocalDataError } from '../../modules/local-data/local-data-error';

import type { SqliteConnection, SqliteDriver } from './sqlite-driver';
import { classifySqliteError } from './sqlite-errors';

/**
 * El turno para cambiar qué archivo es la base (ARQ-12 PR 4b, decidido en la revisión de #318): crearla, apartar una
 * dañada y reponerla, restaurar una copia. Es una base de SQLite aparte, vacía, en la carpeta `datos/`
 * (`.turno-<CUIT>-<entorno>-comprobantes.db`, 0600), y tener el turno es tener una conexión a ella con `BEGIN EXCLUSIVE`. El bloqueo es el del sistema (fcntl en
 * POSIX, LockFileEx en Windows): lo tiene uno solo y se suelta solo si el proceso muere, así que no hay marca, turno
 * viejo, robo ni refresco. Guardar y leer no lo piden: eso lo ordena SQLite sobre la base misma.
 *
 * Está en `datos/` y no al lado de la base porque no se borra nunca (borrarlo mientras otro espera dejaría a dos con
 * turno), y así la carpeta de la base solo tiene la base; además la ruta es más corta que la de la base, para el
 * límite de Windows.
 */

/** La espera del turno, en total: después, `LocalDataError('locked')`. */
const LOCK_WAIT_MS = 40_000;
/** Cada intento espera esto adentro de SQLite (síncrono): corto, para no bloquear el proceso. */
const LOCK_BUSY_TIMEOUT_MS = 50;
const LOCK_POLL_MS = 50;

/** El archivo del turno, solo para el dueño. Si ya está, se usa (vacío o no, es solo para tomar el bloqueo). */
function ensureLockFile(lock: string): void {
  let descriptor: number;

  try {
    descriptor = openSync(lock, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return;
    }

    throw error;
  }

  try {
    if (process.platform !== 'win32') {
      fchmodSync(descriptor, 0o600);
    }
  } finally {
    closeSync(descriptor);
  }
}

/** `BEGIN EXCLUSIVE`; `false` si lo tiene otro. */
function tryTake(connection: SqliteConnection, lock: string): boolean {
  try {
    connection.exec('BEGIN EXCLUSIVE');

    return true;
  } catch (error) {
    const kind = classifySqliteError(error);

    if (kind === 'locked') {
      return false;
    }

    // Un turno dañado no es la base dañada: que nunca lleve a apartarla (el arreglo del turno va a otro ticket).
    if (kind === 'damaged') {
      throw new LocalDataError('unavailable', `El turno ${lock} no es una base de SQLite sana.`, { cause: error });
    }

    throw error;
  }
}

/**
 * Corre `work` con el turno de la base. Si lo tiene otro, espera (de a poco, sin bloquear el proceso más de 50 ms
 * seguidos) hasta que lo suelte o muera. Si no llega en 40 s, `LocalDataError('locked')`. Otro error al pedirlo
 * (carpeta de solo lectura) sale como vino: lo clasifica quien llama.
 */
export async function withDatabaseLock<T>(driver: SqliteDriver, lock: string, work: () => Promise<T> | T): Promise<T> {
  ensureLockFile(lock);

  const connection = driver.open(lock, { mustExist: true, timeoutMs: LOCK_BUSY_TIMEOUT_MS });

  try {
    for (const deadline = Date.now() + LOCK_WAIT_MS; !tryTake(connection, lock); await pause(LOCK_POLL_MS)) {
      if (Date.now() > deadline) {
        throw new LocalDataError('locked', `Otro proceso tiene el turno ${lock} (está creando o reponiendo la base).`);
      }
    }

    try {
      return await work();
    } finally {
      try {
        connection.exec('ROLLBACK');
      } catch {
        // Al cerrar se suelta igual.
      }
    }
  } finally {
    connection.close();
  }
}
