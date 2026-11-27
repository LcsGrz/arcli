import {
  closeSync,
  existsSync,
  linkSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

import { LocalDataError, type LocalDataErrorReason } from '../../modules/local-data/local-data-error';
import type { LocalDataRecovery } from '../../modules/vouchers/voucher-record-store';

import { argentineStamp, listBackupFiles, vacuumInto } from './backup-files';
import {
  buildEmptyDatabase,
  buildTemporary,
  createDatabase,
  databaseExists,
  type DatabaseSpec,
  fileIdentity,
  openOrCreateDatabase,
  openVerified,
  openVerifiedCopy,
  openWritableConnection,
  publishBuilt,
  toLocalDataError,
  withLockOf,
} from './database-file';
import { hasLiveTemporary, NO_HARD_LINKS, removeTemporary } from './database-temporary';
import { inImmediateTransaction, type MigrationContext } from './migrations';
import type { SqliteConnection, SqliteDriver } from './sqlite-driver';

/**
 * Una base dañada (ARQ-12 PR 4b): solo `save` la aparta y la repone; leer da `damaged` sin tocarla. Con el turno de la
 * base (database-lock.ts) y mirándola otra vez: si otro ya la repuso, se usa esa. Primero se arma la base nueva en un
 * temporal (desde la última copia sana, o la anterior si esa también está dañada, o vacía en la última versión, con el
 * evento `base-repuesta`); recién entonces se mueve el original, que nunca se borra ni se reescribe, a
 * `comprobantes.danada-<día>-<hora>.db` con su `-journal`, y se pone la nueva. Si algo falla después de moverlo, vuelve
 * a su lugar. Lo que no es daño (carpeta en lugar del archivo, tomada, solo lectura, disco lleno) no llega acá.
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

const journalOf = (file: string) => `${file}-journal`;
const identityOf = fileIdentity;

/**
 * Los nombres donde va a quedar la base apartada y su `-journal`, tomados con `wx` (vacíos): nadie más los puede usar,
 * así que mover la base encima reemplaza solo el lugar propio y nunca otro archivo. `-2`, `-3` si ya están.
 */
interface Reservation {
  readonly aside: string;
  /** Lo que hay en cada nombre mientras es solo la reserva (para no borrar después lo que se movió ahí). */
  readonly placeholders: ReadonlyMap<string, string | undefined>;
}

function reserve(file: string, reason: 'danada' | 'reemplazada', now: Date): Reservation {
  const base = join(dirname(file), `${basename(file, '.db')}.${reason}-${argentineStamp(now)}`);

  for (let counter = 1; ; counter += 1) {
    const aside = `${base}${counter === 1 ? '' : `-${counter}`}.db`;
    const taken: string[] = [];

    try {
      for (const path of [aside, journalOf(aside)]) {
        closeSync(openSync(path, 'wx', 0o600));
        taken.push(path);
      }

      return { aside, placeholders: new Map(taken.map((path) => [path, identityOf(path)])) };
    } catch (error) {
      taken.forEach((path) => rmSync(path, { force: true }));

      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw toLocalDataError(error);
      }
    }
  }
}

/** Borra las reservas que siguen siendo reservas (vacías y las mismas); lo que se movió a esos nombres queda. */
function dropPlaceholders({ placeholders }: Reservation): void {
  for (const [path, identity] of placeholders) {
    try {
      if (identityOf(path) === identity && statSync(path).size === 0) {
        rmSync(path, { force: true });
      }
    } catch {
      // Ya no está.
    }
  }
}

/** Mueve `from` a su reserva `to`. Si está abierto por otro (Windows), `LocalDataError(busyReason)` sin moverlo. */
async function moveToReserved(from: string, to: string, busyReason: LocalDataErrorReason): Promise<void> {
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

/** Mueve `from` a `to` sin pisar: hard link y después se saca el nombre viejo; sin hard links, rename si no hay nada. */
function moveWithoutClobbering(from: string, to: string): void {
  try {
    linkSync(from, to);
  } catch (error) {
    if (!NO_HARD_LINKS.has((error as NodeJS.ErrnoException).code ?? '')) {
      throw error;
    }

    if (existsSync(to)) {
      throw new LocalDataError('unavailable', `${to} ya está: no se pisa.`);
    }

    renameSync(from, to);

    return;
  }

  unlinkSync(from);
}

/**
 * Devuelve una base apartada (y su `-journal`, primero, para que la base nunca quede sin él) a su lugar, sin pisar lo
 * que haya ahí. Si no se puede, queda apartada: no se borra nada. La usan apartar y restaurar cuando algo falla.
 */
function putBack(aside: string, file: string): void {
  try {
    if (existsSync(journalOf(aside)) && statSync(journalOf(aside)).size > 0) {
      moveWithoutClobbering(journalOf(aside), journalOf(file));
    }

    moveWithoutClobbering(aside, file);
  } catch {
    // Queda apartada, con su nombre.
  }
}

/**
 * Mueve la base y su `-journal` a la reserva. Si el `-journal` no se puede mover, la base vuelve a su lugar: un
 * `-journal` suelto al lado de otra base la rompería.
 */
async function moveAside(file: string, aside: string, busyReason: LocalDataErrorReason): Promise<void> {
  await moveToReserved(file, aside, busyReason);

  if (existsSync(journalOf(file))) {
    try {
      await moveToReserved(journalOf(file), journalOf(aside), busyReason);
    } catch (error) {
      putBack(aside, file);
      throw error;
    }
  }
}

/** Aparta la base a una reserva (`<base>.<motivo>-<día>-<hora>.db`), corre `replace` y, si falla, la devuelve. */
export async function withSetAside<T>(
  file: string,
  reason: 'danada' | 'reemplazada',
  now: Date,
  busyReason: LocalDataErrorReason,
  replace: (aside: string) => Promise<T> | T,
): Promise<T> {
  const reservation = reserve(file, reason, now);

  try {
    return await replace(reservation.aside);
  } finally {
    dropPlaceholders(reservation);
  }
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
 * Arma en un temporal una base desde `source` (una copia ya verificada con `openVerifiedCopy`), con el evento
 * `base-repuesta`. La copia no se mueve ni se toca. Devuelve el temporal, todavía sin ponerlo en su lugar.
 */
export function buildFromCopy(
  driver: SqliteDriver,
  spec: DatabaseSpec,
  context: MigrationContext,
  source: SqliteConnection,
  datos: Record<string, string>,
): string {
  return buildTemporary(spec, context, (temporary) => {
    vacuumInto(source, temporary);

    const connection = openWritableConnection(driver, temporary, spec);

    try {
      inImmediateTransaction(connection, () => addRestoredEvent(connection, context, datos));
    } finally {
      connection.close();
    }
  });
}
/**
 * La base que va a reponer la que falta o está dañada, armada en un temporal: desde `preferred` si sirve (la
 * reemplazada de un restaurar que se cortó, que era la sana), o desde la copia más nueva que sea sana y de esta base
 * (una dañada, de otra base o de un ARCLI más nuevo se saltea, sin tocarla) o, sin ninguna, vacía. Un error al armarla
 * (sin lugar en el disco) sale: no se repone con una vacía por eso.
 */
function buildReplacement(
  driver: SqliteDriver,
  spec: DatabaseSpec,
  context: MigrationContext,
  datos: Record<string, string>,
  preferred?: string,
): { readonly temporary: string; readonly restoredFrom?: string } {
  const candidates = [
    ...(preferred === undefined ? [] : [preferred]),
    ...listBackupFiles(spec.backups).map(({ path }) => path),
  ];

  for (const path of candidates) {
    let source: SqliteConnection;

    try {
      source = openVerifiedCopy(driver, spec, path);
    } catch {
      continue;
    }

    try {
      return {
        restoredFrom: path,
        temporary: buildFromCopy(driver, spec, context, source, { ...datos, copia: basename(path) }),
      };
    } finally {
      source.close();
    }
  }

  return {
    temporary: buildTemporary(spec, context, (temporary) =>
      buildEmptyDatabase(driver, spec, context, temporary, (connection) =>
        addRestoredEvent(connection, context, datos),
      ),
    ),
  };
}

interface SetAsideFile {
  readonly path: string;
  readonly reason: 'danada' | 'reemplazada';
}

/**
 * La apartada más nueva de esta base (dañada o reemplazada al restaurar), por fecha y contador; las de 0 bytes (una
 * reserva que quedó de un proceso muerto) no cuentan.
 */
function latestSetAside(file: string): SetAsideFile | undefined {
  const pattern = new RegExp(
    `^${basename(file, '.db')}\\.(danada|reemplazada)-(\\d{4}-\\d{2}-\\d{2}-\\d{6})(?:-(\\d+))?\\.db$`,
  );
  let names: string[];

  try {
    names = readdirSync(dirname(file));
  } catch {
    return undefined;
  }

  const found = names.flatMap((name) => {
    const match = pattern.exec(name);
    const path = join(dirname(file), name);

    if (!match) {
      return [];
    }

    try {
      if (statSync(path).size === 0) {
        return [];
      }
    } catch {
      return [];
    }

    const [, reason = 'danada', stamp = '', counter = '1'] = match;

    return [{ counter: Number(counter), path, reason: reason as SetAsideFile['reason'], stamp }];
  });

  const latest = found.sort((a, b) => a.stamp.localeCompare(b.stamp) || a.counter - b.counter).at(-1);

  return latest === undefined ? undefined : { path: latest.path, reason: latest.reason };
}

/**
 * Sin base, pero con copias o una apartada al lado: se perdió (la apartó otro que murió antes de reponerla, se cortó
 * un restaurar, o se borró). Se repone en vez de crear una vacía como la primera vez.
 */
function needsRebuild(spec: DatabaseSpec): boolean {
  return (
    !existsSync(spec.file) && (listBackupFiles(spec.backups).length > 0 || latestSetAside(spec.file) !== undefined)
  );
}

/**
 * Un `-journal` que quedó sin su base (la movió un proceso que murió antes de mover el journal) se reproduciría sobre
 * la base nueva: se aparta antes, al lado de la apartada que le corresponde o, si esa ya tiene el suyo, solo, con
 * nombre de dañada. Nunca se borra.
 */
async function setAsideOrphanJournal(file: string, setAside: SetAsideFile | undefined, now: Date): Promise<void> {
  const journal = journalOf(file);

  try {
    if (statSync(journal).size === 0) {
      return;
    }
  } catch {
    return;
  }

  if (setAside !== undefined && !existsSync(journalOf(setAside.path))) {
    moveWithoutClobbering(journal, journalOf(setAside.path));

    return;
  }

  const reservation = reserve(file, 'danada', now);

  try {
    await moveToReserved(journal, journalOf(reservation.aside), 'damaged');
  } finally {
    dropPlaceholders(reservation);
  }
}

/** Con el turno y sin base: la repone (desde la reemplazada de un restaurar cortado, una copia o vacía). */
async function rebuildMissing(
  driver: SqliteDriver,
  spec: DatabaseSpec,
  context: MigrationContext,
): Promise<LocalDataRecovery> {
  const setAside = latestSetAside(spec.file);
  const { restoredFrom, temporary } = buildReplacement(
    driver,
    spec,
    context,
    setAside === undefined ? {} : { apartada: basename(setAside.path) },
    setAside?.reason === 'reemplazada' ? setAside.path : undefined,
  );

  try {
    await setAsideOrphanJournal(spec.file, setAside, new Date(context.now));
  } catch (error) {
    removeTemporary(temporary);
    throw error;
  }

  publishBuilt(spec, temporary, 'fail');

  return {
    ...(restoredFrom === undefined ? {} : { restoredFrom }),
    ...(setAside === undefined ? {} : { setAside: setAside.path }),
  };
}

/** Con el turno y sin base: la repone si se perdió, o la crea vacía si es la primera vez. */
async function createOrRebuild(
  driver: SqliteDriver,
  spec: DatabaseSpec,
  context: MigrationContext,
): Promise<LocalDataRecovery | undefined> {
  if (needsRebuild(spec)) {
    return rebuildMissing(driver, spec, context);
  }

  createDatabase(driver, spec, context);

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
 * Con el turno: si sigue dañada, arma la nueva, aparta la dañada y pone la nueva. Con un temporal vivo al lado no se
 * toca (otro puede estar copiándola a su lugar); una cortada muy reciente se vuelve a mirar unos segundos antes.
 */
async function recoverWithLock(
  driver: SqliteDriver,
  spec: DatabaseSpec,
  context: MigrationContext,
): Promise<LocalDataRecovery | undefined> {
  for (const deadline = Date.now() + RECENT_DAMAGE_WAIT_MS; ; await pause(RECENT_DAMAGE_POLL_MS)) {
    const damage = damageOf(driver, spec, context);

    if (damage === undefined) {
      return databaseExists(spec.file) ? undefined : createOrRebuild(driver, spec, context);
    }

    if (hasLiveTemporary(spec.file, Date.now())) {
      throw damage;
    }

    if (!isRecent(spec.file) || Date.now() >= deadline) {
      break;
    }
  }

  return withSetAside(spec.file, 'danada', new Date(context.now), 'damaged', async (aside) => {
    const { restoredFrom, temporary } = buildReplacement(driver, spec, context, { apartada: basename(aside) });

    await swapIn(spec, aside, temporary, 'damaged');

    return restoredFrom === undefined ? { setAside: aside } : { restoredFrom, setAside: aside };
  });
}

/**
 * Cambia la base por la ya armada en `temporary`: aparta la actual (con su `-journal`) a su reserva y pone la nueva.
 * Si no se puede apartar, no se toca nada; si no se puede poner la nueva (también si apareció otro archivo en su
 * lugar: no se pisa), la apartada vuelve a su lugar si se puede y sale el error. La ventana sin base es solo la de
 * mover y poner: lo lento (armar la nueva) ya pasó.
 */
export async function swapIn(
  spec: DatabaseSpec,
  aside: string,
  temporary: string,
  busyReason: LocalDataErrorReason,
): Promise<void> {
  try {
    await moveAside(spec.file, aside, busyReason);
  } catch (error) {
    removeTemporary(temporary);
    throw error;
  }

  try {
    publishBuilt(spec, temporary, 'fail');
  } catch (error) {
    putBack(aside, spec.file);
    throw error;
  }
}

/**
 * Para `save`: la base abierta y verificada como `openOrCreateDatabase`, y si está dañada (o falta y hay copias o una
 * apartada), repuesta antes, con el dato de la recuperación. Todo lo que cambia qué archivo es la base corre con el
 * turno. Un error al pedir el turno (carpeta de solo lectura) sale como ese error (`read-only`) sin tocar la base: no
 * se pudo apartar, y arreglando el permiso el próximo `save` la repone.
 */
export async function openRecoveringDatabase(
  driver: SqliteDriver,
  spec: DatabaseSpec,
  context: MigrationContext,
): Promise<{ readonly connection: SqliteConnection; readonly recovered?: LocalDataRecovery }> {
  let recovered: LocalDataRecovery | undefined;

  try {
    const connection = await openOrCreateDatabase(driver, spec, context, async () => {
      recovered = await createOrRebuild(driver, spec, context);
    });

    return recovered === undefined ? { connection } : { connection, recovered };
  } catch (error) {
    if (!(error instanceof LocalDataError) || error.reason !== 'damaged') {
      throw error;
    }
  }

  recovered = await withLockOf(driver, spec, () => recoverWithLock(driver, spec, context));

  const connection = openVerified(driver, spec, context);

  return recovered === undefined ? { connection } : { connection, recovered };
}
