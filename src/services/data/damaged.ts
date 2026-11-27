import { existsSync, renameSync, statSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

import { LocalDataError, type LocalDataErrorReason } from '../../modules/local-data/local-data-error';
import type { LocalDataRecovery } from '../../modules/vouchers/voucher-record-store';

import { argentineStamp, freePath, listBackupFiles, vacuumInto } from './backup-files';
import {
  createDatabase,
  databaseExists,
  type DatabaseSpec,
  openOrCreateDatabase,
  openVerified,
  openVerifiedCopy,
  openWritableConnection,
  publishBuiltDatabase,
  toLocalDataError,
  withLockOf,
} from './database-file';
import { hasLiveTemporary } from './database-temporary';
import { inImmediateTransaction, type MigrationContext } from './migrations';
import type { SqliteConnection, SqliteDriver } from './sqlite-driver';

/**
 * Una base dañada (ARQ-12 PR 4b): solo `save` la aparta y la repone; leer da `damaged` sin tocarla. Con el turno de la
 * base (database-lock.ts) y mirándola otra vez: si otro ya la repuso, se usa esa. El original se mueve, nunca se
 * borra ni se reescribe, como `comprobantes.danada-<día>-<hora>.db` con su `-journal`. La base nueva sale de la última
 * copia sana (o de la anterior, si esa también está dañada) o, sin copias, vacía en la última versión, con el evento
 * `base-repuesta`. Lo que no es daño (carpeta en lugar del archivo, tomada, solo lectura, disco lleno) no llega acá.
 */

/** Una base cortada con menos de esto puede ser otra que se está copiando a su lugar (sin hard links). */
const RECENT_DAMAGE_MS = 10_000;
/** Cuánto se vuelve a mirar una base cortada muy reciente antes de apartarla, y cada cuánto. */
const RECENT_DAMAGE_WAIT_MS = 3000;
const RECENT_DAMAGE_POLL_MS = 250;

/** En Windows, mover un archivo que otro tiene abierto da EBUSY o EPERM: se reintenta un rato y después se rinde. */
const MOVE_ATTEMPTS = 5;
const MOVE_PAUSE_MS = 100;
const BUSY_CODES = new Set(['EBUSY', 'EPERM']);

/** Mueve `from` a `to`. Si está abierto por otro (Windows), `LocalDataError(busyReason)` sin haberlo movido. */
async function move(from: string, to: string, busyReason: LocalDataErrorReason): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      renameSync(from, to);

      return;
    } catch (error) {
      const { code = '' } = error as NodeJS.ErrnoException;

      if (!BUSY_CODES.has(code)) {
        throw toLocalDataError(error);
      }

      if (attempt >= MOVE_ATTEMPTS) {
        throw new LocalDataError(busyReason, `${from} está abierta por otro programa: no se pudo mover.`, {
          cause: error,
        });
      }
    }

    await pause(MOVE_PAUSE_MS);
  }
}

/**
 * Mueve la base y su `-journal` a `comprobantes.<motivo>-<día>-<hora>.db` en su carpeta, sin pisar nada. Si el
 * `-journal` no se puede mover, la base vuelve a su lugar: un `-journal` suelto al lado de otra base la rompería.
 */
export async function setAside(
  file: string,
  reason: 'danada' | 'reemplazada',
  now: Date,
  busyReason: LocalDataErrorReason,
): Promise<string> {
  const aside = freePath(dirname(file), `${basename(file, '.db')}.${reason}-${argentineStamp(now)}`, '.db');

  await move(file, aside, busyReason);

  if (existsSync(`${file}-journal`)) {
    try {
      await move(`${file}-journal`, `${aside}-journal`, busyReason);
    } catch (error) {
      try {
        renameSync(aside, file);
      } catch {
        // Queda apartada sin su -journal, que sigue al lado de donde estaba: no se borra nada.
      }

      throw error;
    }
  }

  return aside;
}

/** Anota en la base nueva de dónde salió: el evento `base-repuesta` (sin CAE), con los nombres de los archivos. */
function addRestoredEvent(connection: SqliteConnection, context: MigrationContext, datos: Record<string, string>) {
  connection.run(
    `INSERT INTO eventos (cae, tipo, ocurrido_el, version_arcli, datos)
    VALUES (NULL, 'base-repuesta', :ocurrido_el, :version_arcli, :datos)`,
    { datos: JSON.stringify(datos), ocurrido_el: context.now, version_arcli: context.version },
  );
}

/**
 * Pone en el lugar de la base (que ya no está) una copia de `copy`, con el evento `base-repuesta`. La copia tiene que
 * ser sana y de esta base (`openVerifiedCopy`); no se mueve ni se toca.
 */
export function publishFromCopy(
  driver: SqliteDriver,
  spec: DatabaseSpec,
  context: MigrationContext,
  copy: string,
  datos: Record<string, string>,
): void {
  const source = openVerifiedCopy(driver, spec, copy);

  try {
    publishBuiltDatabase(spec, context, (temporary) => {
      vacuumInto(source, temporary);

      const connection = openWritableConnection(driver, temporary, spec);

      try {
        inImmediateTransaction(connection, () => addRestoredEvent(connection, context, datos));
      } finally {
        connection.close();
      }
    });
  } finally {
    source.close();
  }
}

/** Repone desde la copia más nueva que sirva; sin ninguna, una base vacía. Devuelve la copia que se usó. */
function replaceDamaged(
  driver: SqliteDriver,
  spec: DatabaseSpec,
  context: MigrationContext,
  setAsideFile: string,
): string | undefined {
  const apartada = basename(setAsideFile);

  for (const { path } of listBackupFiles(spec.backups)) {
    try {
      publishFromCopy(driver, spec, context, path, { apartada, copia: basename(path) });

      return path;
    } catch {
      // Dañada, de otra base o de un ARCLI más nuevo: se prueba la anterior. Ninguna se toca.
    }
  }

  createDatabase(driver, spec, context, (connection) => addRestoredEvent(connection, context, { apartada }));

  return undefined;
}

/** `damaged` si la base está dañada; `undefined` si está sana (y la deja como estaba) o si no está. */
function damageOf(driver: SqliteDriver, spec: DatabaseSpec, context: MigrationContext): LocalDataError | undefined {
  try {
    if (databaseExists(spec.file)) {
      openVerified(driver, spec, context).close();
    }

    return undefined;
  } catch (error) {
    if (error instanceof LocalDataError && error.reason === 'damaged') {
      return error;
    }

    throw error;
  }
}

function isRecent(file: string): boolean {
  try {
    return Date.now() - statSync(file).mtimeMs < RECENT_DAMAGE_MS;
  } catch {
    return false;
  }
}

/**
 * Con el turno: si sigue dañada, la aparta y la repone. Con un temporal vivo al lado no se toca (otro puede estar
 * copiándola a su lugar); una cortada muy reciente se vuelve a mirar unos segundos antes de apartarla.
 */
async function recoverWithLock(
  driver: SqliteDriver,
  spec: DatabaseSpec,
  context: MigrationContext,
): Promise<LocalDataRecovery | undefined> {
  for (const deadline = Date.now() + RECENT_DAMAGE_WAIT_MS; ; await pause(RECENT_DAMAGE_POLL_MS)) {
    const damage = damageOf(driver, spec, context);

    if (damage === undefined) {
      if (!databaseExists(spec.file)) {
        // La apartó otro que murió antes de reponerla: se crea vacía, como la primera vez.
        createDatabase(driver, spec, context);
      }

      return undefined;
    }

    if (hasLiveTemporary(spec.file, Date.now())) {
      throw damage;
    }

    if (!isRecent(spec.file) || Date.now() >= deadline) {
      break;
    }
  }

  const setAsideFile = await setAside(spec.file, 'danada', new Date(context.now), 'damaged');
  const restoredFrom = replaceDamaged(driver, spec, context, setAsideFile);

  return restoredFrom === undefined ? { setAside: setAsideFile } : { restoredFrom, setAside: setAsideFile };
}

/**
 * Para `save`: la base abierta y verificada como `openOrCreateDatabase`, y si está dañada, apartada y repuesta antes,
 * con el dato de la recuperación. Un error al pedir el turno (carpeta de solo lectura) sale como ese error
 * (`read-only`) sin tocar la base: no se pudo apartar, y arreglando el permiso el próximo `save` la repone.
 */
export async function openRecoveringDatabase(
  driver: SqliteDriver,
  spec: DatabaseSpec,
  context: MigrationContext,
): Promise<{ readonly connection: SqliteConnection; readonly recovered?: LocalDataRecovery }> {
  try {
    return { connection: await openOrCreateDatabase(driver, spec, context) };
  } catch (error) {
    if (!(error instanceof LocalDataError) || error.reason !== 'damaged') {
      throw error;
    }
  }

  const recovered = await withLockOf(spec, () => recoverWithLock(driver, spec, context));
  const connection = openVerified(driver, spec, context);

  return recovered === undefined ? { connection } : { connection, recovered };
}
