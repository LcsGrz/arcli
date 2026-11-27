import type { LocalDataErrorReason } from '../../modules/local-data/local-data-error';

/** Lo que dice un error de SQLite, por su código base (`errcode & 0xff`): una razón de `LocalDataError` o unicidad. */
export type SqliteErrorKind =
  Extract<LocalDataErrorReason, 'damaged' | 'disk-full' | 'locked' | 'read-only' | 'unavailable'> | 'unique';

/**
 * Por código base: 5 y 6 → `locked`; 11 y 26 → `damaged`; 14 → `unavailable`; 8 → `read-only`; 13 → `disk-full`;
 * 19 → `unique`. `undefined` si no es un error de SQLite o el código no está en la lista.
 *
 * @internal Stub de Tests primero (ARQ-12 PR 4a): lo implementa nucleo.
 */
export function classifySqliteError(_error: unknown): SqliteErrorKind | undefined {
  throw new Error('no implementado: stub de Tests primero (ARQ-12 PR 4a), lo implementa nucleo');
}
