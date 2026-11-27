import { closeSync, existsSync, linkSync, openSync, renameSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

import { LocalDataError, type LocalDataErrorReason } from '../../modules/local-data/local-data-error';

import { argentineStamp } from './backup-files';
import { fileIdentity, toLocalDataError } from './database-file';
import { NO_HARD_LINKS } from './database-temporary';

/**
 * Apartar una base (ARQ-12 PR 4b): reservar el nombre de la apartada y su `-journal` con `wx`, moverlas sin pisar
 * nada y, si algo falla, devolverlas a su lugar. Lo usan reponer una dañada y restaurar (damaged.ts, backups.ts).
 */

export const journalOf = (file: string) => `${file}-journal`;
const identityOf = fileIdentity;

/** En Windows, mover un archivo que otro tiene abierto da EBUSY o EPERM: se reintenta un rato y después se rinde. */
const MOVE_ATTEMPTS = 5;
const MOVE_PAUSE_MS = 100;
const BUSY_CODES = new Set(['EBUSY', 'EPERM']);

/**
 * Los nombres donde va a quedar la base apartada y su `-journal`, tomados con `wx` (vacíos): nadie más los puede usar,
 * así que mover la base encima reemplaza solo el lugar propio y nunca otro archivo. `-2`, `-3` si ya están.
 */
export interface Reservation {
  readonly aside: string;
  /** Lo que hay en cada nombre mientras es solo la reserva (para no borrar después lo que se movió ahí). */
  readonly placeholders: ReadonlyMap<string, string | undefined>;
}

export function reserve(file: string, reason: 'danada' | 'reemplazada', now: Date): Reservation {
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
export function dropPlaceholders({ placeholders }: Reservation): void {
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
export async function moveToReserved(from: string, to: string, busyReason: LocalDataErrorReason): Promise<void> {
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
export function moveWithoutClobbering(from: string, to: string): void {
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
export function putBack(aside: string, file: string): void {
  try {
    // Primero la base: si en su lugar hay otro archivo, no vuelve nada y el -journal sigue con la apartada (al lado del
    // intruso lo rompería).
    moveWithoutClobbering(aside, file);
  } catch {
    return;
  }

  try {
    if (!isEmptyOrMissing(journalOf(aside))) {
      moveWithoutClobbering(journalOf(aside), journalOf(file));
    }
  } catch {
    // Queda al lado de donde estaba la apartada: no se borra nada.
  }
}

/** No está, o pesa 0 bytes (una reserva de un proceso que murió). */
export function isEmptyOrMissing(path: string): boolean {
  try {
    return statSync(path).size === 0;
  } catch {
    return true;
  }
}

/**
 * Mueve la base y su `-journal` a la reserva. Si el `-journal` no se puede mover, la base vuelve a su lugar: un
 * `-journal` suelto al lado de otra base la rompería.
 */
export async function moveAside(file: string, aside: string, busyReason: LocalDataErrorReason): Promise<void> {
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
