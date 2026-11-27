import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fstatSync,
  linkSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  utimesSync,
  writeSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

import { LocalDataError } from '../../modules/local-data/local-data-error';

/**
 * El turno para cambiar qué archivo es la base (ARQ-12 PR 4b): crearla, apartar una dañada y reponerla, o restaurar
 * una copia. Es un archivo al lado de la base (`.bloqueo-comprobantes.db`) creado con `wx`, con una marca de quién lo
 * tiene (pid, máquina y algo al azar): lo tiene uno solo. Así dos procesos que encuentran la base dañada a la vez no
 * la apartan dos veces, y uno que la encuentra sin base no crea una vacía mientras otro está reponiendo la de la
 * copia. Guardar y leer no lo piden: eso lo ordena SQLite.
 */

/** Uno sin tocar hace más que esto es de un proceso que murió con el turno: quien lo tiene lo refresca seguido. */
const STALE_LOCK_MS = 30_000;
/** Cada cuánto lo refresca quien lo tiene, mientras el proceso no esté ocupado en una llamada síncrona a SQLite. */
const REFRESH_MS = 2000;
/** La espera del turno: más que `STALE_LOCK_MS`, así uno que quedó de un proceso muerto se toma antes de rendirse. */
const LOCK_WAIT_MS = 40_000;
const LOCK_POLL_MS = 50;

function lockPath(file: string): string {
  return join(dirname(file), `.bloqueo-${basename(file)}`);
}

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;

/** Crea el turno con la marca de este dueño; `false` si ya lo tiene otro. */
function tryCreate(lock: string, token: string): boolean {
  let descriptor: number;

  try {
    descriptor = openSync(lock, 'wx', 0o600);
  } catch (error) {
    if (errorCode(error) === 'EEXIST') {
      return false;
    }

    throw error;
  }

  try {
    writeSync(descriptor, token);
  } finally {
    closeSync(descriptor);
  }

  return true;
}

/**
 * Qué turno es: dispositivo, inodo, fecha de modificación y la marca de adentro. El inodo solo no alcanza: en Linux el
 * de un turno recién borrado se reusa enseguida para el siguiente (CI de #318). `undefined` si no está.
 */
function readLock(path: string): { readonly identity: string; readonly mtimeMs: number } | undefined {
  let descriptor: number;

  try {
    descriptor = openSync(path, 'r');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return undefined;
    }

    throw error;
  }

  // Todo del mismo archivo abierto: mirar la ruta dos veces sería una carrera.
  try {
    const { dev, ino, mtimeMs } = fstatSync(descriptor);

    return { identity: `${dev}:${ino}:${mtimeMs}:${readFileSync(descriptor, 'utf8')}`, mtimeMs };
  } finally {
    closeSync(descriptor);
  }
}

function identityOf(path: string): string | undefined {
  try {
    return readLock(path)?.identity;
  } catch {
    return undefined;
  }
}

/** Qué turno es y si es viejo; `undefined` si no está (lo soltó el otro mientras se miraba). */
function lockState(lock: string): { readonly identity: string; readonly stale: boolean } | undefined {
  const state = readLock(lock);

  return state === undefined
    ? undefined
    : { identity: state.identity, stale: Date.now() - state.mtimeMs > STALE_LOCK_MS };
}

function removeQuietly(path: string): void {
  try {
    rmSync(path, { force: true, maxRetries: 3 });
  } catch {
    // Queda un archivo suelto con nombre al azar; no es el turno.
  }
}

/**
 * Saca de su lugar el turno `expected` (el que se vio viejo, o el propio) sin tocar uno que otro haya tomado en el
 * medio: lo mueve a un nombre al azar y mira si era ese. Si era otro, lo devuelve con un hard link (que no pisa: si
 * ya hay uno, vale ese). `true` si sacó el esperado.
 */
function takeAway(lock: string, expected: (moved: string) => boolean): boolean {
  const moved = `${lock}.${randomBytes(6).toString('hex')}`;

  try {
    renameSync(lock, moved);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return false;
    }

    throw error;
  }

  if (expected(moved)) {
    removeQuietly(moved);

    return true;
  }

  try {
    linkSync(moved, lock);
  } catch {
    // Ya hay otro turno en su lugar, o el sistema no tiene hard links: el que tenía este lo va a ver al refrescar.
  }

  removeQuietly(moved);

  return false;
}

/** Suelta el propio sin fallar: no poder (un antivirus en Windows) no hace fallar lo que ya se hizo. */
function release(lock: string, token: string): void {
  try {
    takeAway(lock, (moved) => readFileSync(moved, 'utf8') === token);
  } catch {
    // Queda hasta que se vuelva viejo (`STALE_LOCK_MS`).
  }
}

/**
 * Corre `work` con el turno de la base. Si lo tiene otro, espera (sin bloquear el proceso) hasta que lo suelte; uno
 * viejo se saca (solo ese: si otro lo tomó en el medio, se le devuelve). Si no llega, `LocalDataError('locked')`.
 * Otro error al pedirlo (carpeta de solo lectura) sale como vino: lo clasifica quien llama. Mientras corre, el turno
 * se refresca cada `REFRESH_MS`; el trabajo con turno es corto (crear, apartar y reponer una base), pero una llamada
 * síncrona a SQLite de más de 30 s (un `VACUUM INTO` de una base enorme) no lo refresca.
 */
export async function withDatabaseLock<T>(file: string, work: () => Promise<T> | T): Promise<T> {
  const lock = lockPath(file);
  const token = `${process.pid}@${hostname()}:${randomBytes(8).toString('hex')}`;

  for (const deadline = Date.now() + LOCK_WAIT_MS; !tryCreate(lock, token);) {
    const state = lockState(lock);

    if (state === undefined) {
      continue;
    }

    if (state.stale) {
      takeAway(lock, (moved) => identityOf(moved) === state.identity);
    } else if (Date.now() > deadline) {
      throw new LocalDataError('locked', `Otro proceso está creando o reponiendo ${file}.`);
    } else {
      await pause(LOCK_POLL_MS);
    }
  }

  const refresh = setInterval(() => {
    try {
      const now = new Date();

      utimesSync(lock, now, now);
    } catch {
      // Se refresca en la próxima.
    }
  }, REFRESH_MS);

  refresh.unref();

  try {
    return await work();
  } finally {
    clearInterval(refresh);
    release(lock, token);
  }
}
