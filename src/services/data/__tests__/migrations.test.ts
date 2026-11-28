import { describe, expect, it, vi } from 'vitest';

import { migrate, type MigrationBackup } from '../migrations';
import type { SqliteConnection } from '../sqlite-driver';

const CONTEXT = { now: '2026-11-26T15:00:00.000Z', version: '9.9.9-test' } as const;
const COPY = 'comprobantes-2026-11-26-120000-antes-de-1001.db';
const STEP_ERROR = new Error('paso roto');

/** Lo que se lee después de que el paso lanzó: la versión y si `migraciones` nombra la copia (o un error). */
interface AfterFailure {
  readonly version: number | Error;
  readonly recorded: boolean | Error;
}

/**
 * Una base en 1000 cuyo paso a 1001 lanza `STEP_ERROR`. Antes, la versión es 1000; después, lo que diga `after`. El
 * ROLLBACK no falla.
 */
function failingMigration(after: AfterFailure): SqliteConnection {
  let failed = false;
  const read = <T>(value: T | Error): T => {
    if (value instanceof Error) {
      throw value;
    }

    return value;
  };

  return {
    all: () => [],
    close: () => undefined,
    // El paso: lanza y desde ahí vale `after`. BEGIN, ROLLBACK y lo demás no hacen nada.
    exec(sql) {
      if (sql === 'PASO') {
        failed = true;
        throw STEP_ERROR;
      }
    },
    get(sql): ReturnType<SqliteConnection['get']> {
      if (sql === 'PRAGMA user_version') {
        return { user_version: failed ? read(after.version) : 1000 };
      }

      if (sql.includes('FROM migraciones WHERE copia')) {
        return read(after.recorded) ? { anotada: 1 } : undefined;
      }

      throw new Error(`consulta inesperada: ${sql}`);
    },
    run: () => ({ changes: 1 }),
  };
}

function backupSpy(): MigrationBackup & { readonly discarded: string[] } {
  const discarded: string[] = [];

  return { discard: (copy) => discarded.push(copy), discarded, settle: vi.fn(), take: () => COPY };
}

const STEP = [{ up: (exec: (sql: string) => void) => exec('PASO'), version: 1001 }];

describe('migrate, si la transacción lanza (ARQ-29, revisión de #322)', () => {
  it.each<[string, AfterFailure, boolean]>([
    ['sigue en from y no está anotada: se descarta', { recorded: false, version: 1000 }, true],
    ['la versión ya no es from, aunque no esté anotada: queda', { recorded: false, version: 1001 }, false],
    ['sigue en from pero está anotada: queda', { recorded: true, version: 1000 }, false],
    ['leer la versión falla: queda', { recorded: false, version: new Error('no se lee la versión') }, false],
    ['leer migraciones falla: queda', { recorded: new Error('no se lee migraciones'), version: 1000 }, false],
  ])('%s, y sale el error de la migración', (_name, after, discarded) => {
    const backup = backupSpy();

    let thrown: unknown;

    try {
      migrate(failingMigration(after), STEP, CONTEXT, backup);
    } catch (error) {
      thrown = error;
    }

    // El de la migración, el mismo objeto: no el de la lectura que vino después.
    expect(thrown).toBe(STEP_ERROR);
    expect(backup.discarded).toEqual(discarded ? [COPY] : []);
    expect(backup.settle).not.toHaveBeenCalled();
  });
});
