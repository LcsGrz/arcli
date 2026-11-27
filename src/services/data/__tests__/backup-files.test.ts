import { chmodSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { listBackupFiles, pruneMigrationBackups } from '../backup-files';

import {
  backupNames,
  backupsFolder,
  makeOld,
  NOW,
  openStore,
  permissions,
  temporaryDataDirectory,
  voucherRecord,
  withPermissions,
} from './local-data.fixtures';

/**
 * Los archivos de las copias (ARQ-12 PR 4b): la lista, el orden y la retención de las de antes de migrar, que aplica
 * quien migró entre las anotadas en `migraciones.copia` y sin borrar la de otro proceso que todavía está migrando.
 */
const target = (folder: string) => ({ folder, prefix: 'comprobantes' });

describe('retención de las copias de antes de migrar (ARQ-12 PR 4b)', () => {
  it('quedan las 2 anotadas más nuevas; una sin anotar más nueva queda, una sin anotar más vieja se borra', () => {
    const folder = temporaryDataDirectory();
    const names = {
      anotadaNueva: 'comprobantes-2026-11-26-110000-antes-de-1003.db',
      anotadaMedia: 'comprobantes-2026-11-26-100000-antes-de-1002.db',
      anotadaVieja: 'comprobantes-2026-11-26-090000-antes-de-1001.db',
      enVuelo: 'comprobantes-2026-11-26-115000-antes-de-1004.db',
      sinAnotarVieja: 'comprobantes-2026-11-26-103000-antes-de-1003.db',
    };

    for (const name of Object.values(names)) {
      writeFileSync(join(folder, name), 'copia');
    }

    pruneMigrationBackups(
      target(folder),
      new Set([names.anotadaNueva, names.anotadaMedia, names.anotadaVieja]),
      new Date(NOW),
    );

    expect(readdirSync(folder).sort()).toEqual([names.anotadaMedia, names.anotadaNueva, names.enVuelo].sort());
  });

  it('sin ninguna anotada no falla ni borra las de otros en vuelo', () => {
    const folder = temporaryDataDirectory();

    writeFileSync(join(folder, 'comprobantes-2026-11-26-110000-antes-de-1001.db'), 'copia');

    expect(() => pruneMigrationBackups(target(folder), new Set(), new Date(NOW))).not.toThrow();
    expect(readdirSync(folder)).toEqual(['comprobantes-2026-11-26-110000-antes-de-1001.db']);
  });
});

describe('la lista de copias (ARQ-12 PR 4b)', () => {
  it('una carpeta con nombre de copia no es una copia', () => {
    const folder = temporaryDataDirectory();

    mkdirSync(join(folder, 'comprobantes-2026-11-26-120000.db'));
    writeFileSync(join(folder, 'comprobantes-2026-11-26-110000.db'), 'copia');

    expect(listBackupFiles(target(folder)).map(({ path }) => basename(path))).toEqual([
      'comprobantes-2026-11-26-110000.db',
    ]);
  });

  // En el mismo segundo: la diaria (después del COMMIT) es la última; entre las de migración, el esquema más nuevo; y
  // con el mismo nombre, el contador más alto.
  it('en el mismo segundo ordena diaria, esquema y contador', () => {
    const folder = temporaryDataDirectory();

    for (const name of [
      'comprobantes-2026-11-26-120000-antes-de-1001.db',
      'comprobantes-2026-11-26-120000-antes-de-1002.db',
      'comprobantes-2026-11-26-120000.db',
      'comprobantes-2026-11-26-120000-2.db',
      'comprobantes-2026-11-26-110000.db',
    ]) {
      writeFileSync(join(folder, name), 'copia');
    }

    expect(listBackupFiles(target(folder)).map(({ path }) => basename(path))).toEqual([
      'comprobantes-2026-11-26-120000-2.db',
      'comprobantes-2026-11-26-120000.db',
      'comprobantes-2026-11-26-120000-antes-de-1002.db',
      'comprobantes-2026-11-26-120000-antes-de-1001.db',
      'comprobantes-2026-11-26-110000.db',
    ]);
  });
});

describe('la carpeta de copias (ARQ-12 PR 4b)', () => {
  // Una carpeta de copias que ya estaba (de otro programa, con umask 022) queda solo para el dueño al copiar, y los
  // temporales viejos de un proceso muerto se limpian.
  it.runIf(withPermissions)('una carpeta que ya estaba queda 0700 y se limpian sus temporales viejos', async () => {
    const dataDirectory = temporaryDataDirectory();
    const folder = backupsFolder(dataDirectory);
    const old = join(folder, '.nueva-00000001');

    await openStore(dataDirectory, { backups: { enabled: false } }).save(voucherRecord());
    mkdirSync(folder, { recursive: true });
    chmodSync(folder, 0o755);
    writeFileSync(old, '');
    makeOld(old);

    await openStore(dataDirectory, { backups: { enabled: true } }).save(
      voucherRecord({ cae: '76123456789013', numero: 2 }),
    );

    expect(permissions(folder)).toBe(0o700);
    expect(backupNames(dataDirectory)).toEqual(['comprobantes-2026-11-26-120000.db']);
  });
});
