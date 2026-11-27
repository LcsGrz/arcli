import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { openSqliteConnection } from '../sqlite-driver';

import { cae, record, restoredEvents } from './damaged-database.fixtures';
import {
  backupNames,
  backupsFolder,
  caes,
  fingerprint,
  makeOld,
  openStore,
  temporaryDataDirectory,
  vouchersFile,
} from './local-data.fixtures';

/**
 * De dónde sale la base nueva y qué pasa con los `-journal` sueltos (ARQ-12 PR 4b, huecos que dejó Stryker en #318):
 * una reemplazada sin copias, un `-journal` huérfano al crear la primera vez o cuando la apartada ya tiene el suyo, una
 * reserva que choca con un `-journal` que quedó, y una copia con un `-journal` caliente que no se toca.
 */
const OFF = { enabled: false } as const;
const NEXT = record(50);
const folderOf = (dataDirectory: string) => dirname(vouchersFile(dataDirectory));

describe('la fuente de la base nueva (ARQ-12 PR 4b)', () => {
  it('sin copias, una reemplazada que quedó de un restaurar cortado repone la base', async () => {
    const dataDirectory = temporaryDataDirectory();
    const file = vouchersFile(dataDirectory);
    const replaced = join(folderOf(dataDirectory), 'comprobantes.reemplazada-2026-11-26-120000.db');

    await openStore(dataDirectory, { backups: OFF }).save(record(1));
    renameSync(file, replaced);

    const outcome = await openStore(dataDirectory, { backups: OFF }).save(NEXT);

    expect(outcome).toMatchObject({ kind: 'saved', recovered: { restoredFrom: replaced, setAside: replaced } });
    expect(caes(file)).toEqual([cae(1), NEXT.cae]);
  });

  // Una copia con un -journal caliente al lado se abre readOnly: SQLite no lo deshace y la copia queda igual.
  it('una copia con un -journal caliente al lado no se toca: se repone desde la anterior', async () => {
    const dataDirectory = temporaryDataDirectory();
    const file = vouchersFile(dataDirectory);
    const folder = backupsFolder(dataDirectory);

    await openStore(dataDirectory, { backups: { enabled: true } }).save(record(1));

    const [older = ''] = backupNames(dataDirectory).map((name) => join(folder, name));
    const newer = join(folder, 'comprobantes-2026-11-26-130000.db');
    const writer = await openSqliteConnection(file, { timeoutMs: 1000 });

    // Una foto de la base y su -journal en medio de una escritura: el journal queda caliente para esa copia.
    writer.exec('PRAGMA journal_mode = DELETE; PRAGMA cache_size = 1; BEGIN IMMEDIATE');

    for (let index = 0; index < 400; index += 1) {
      writer.run("INSERT INTO eventos (tipo, ocurrido_el, version_arcli, datos) VALUES ('x', 'y', 'z', NULL)");
    }

    copyFileSync(file, newer);
    copyFileSync(`${file}-journal`, `${newer}-journal`);
    writer.exec('ROLLBACK');
    writer.close();

    const before = { copy: fingerprint(newer), journal: fingerprint(`${newer}-journal`) };

    rmSync(file);

    const outcome = await openStore(dataDirectory, { backups: OFF }).save(NEXT);

    expect(outcome).toMatchObject({ recovered: { restoredFrom: older } });
    expect({ copy: fingerprint(newer), journal: fingerprint(`${newer}-journal`) }).toEqual(before);
  });
});

describe('un -journal suelto al poner una base donde falta (ARQ-12 PR 4b)', () => {
  it('la primera vez, sin copias ni apartadas: el -journal huérfano queda como el de una dañada', async () => {
    const dataDirectory = temporaryDataDirectory();
    const folder = folderOf(dataDirectory);

    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'comprobantes.db-journal'), 'journal huérfano');

    await expect(openStore(dataDirectory, { backups: OFF }).save(NEXT)).resolves.toEqual({ kind: 'saved' });

    const journals = readdirSync(folder).filter((name) => name.endsWith('-journal'));

    expect(journals).toEqual([expect.stringMatching(/^comprobantes\.danada-.*\.db-journal$/)]);
    expect(readFileSync(join(folder, journals[0] ?? ''), 'utf8')).toBe('journal huérfano');
    expect(readdirSync(folder).filter((name) => name.includes('danada') && name.endsWith('.db'))).toEqual([]);
  });

  it('si la apartada ya tiene su -journal, el huérfano queda aparte y ninguno se pisa', async () => {
    const dataDirectory = temporaryDataDirectory();
    const folder = folderOf(dataDirectory);
    const aside = join(folder, 'comprobantes.danada-2026-11-26-120000.db');

    mkdirSync(folder, { recursive: true });
    writeFileSync(aside, 'dañada');
    writeFileSync(`${aside}-journal`, 'el suyo');
    writeFileSync(join(folder, 'comprobantes.db-journal'), 'huérfano');

    const outcome = await openStore(dataDirectory, { backups: OFF }).save(NEXT);

    expect(outcome).toMatchObject({ recovered: { setAside: aside } });
    expect(readFileSync(`${aside}-journal`, 'utf8')).toBe('el suyo');
    expect(readFileSync(join(folder, 'comprobantes.danada-2026-11-26-120000-2.db-journal'), 'utf8')).toBe('huérfano');
    expect(existsSync(join(folder, 'comprobantes.db-journal'))).toBe(false);
    expect(restoredEvents(vouchersFile(dataDirectory))).toHaveLength(1);
  });

  // La reserva toma la base y su -journal juntos: si el -journal ya está, prueba el nombre siguiente y suelta la base.
  it('si el nombre del -journal de la apartada ya está tomado, aparta con el siguiente y no deja reservas', async () => {
    const dataDirectory = temporaryDataDirectory();
    const file = vouchersFile(dataDirectory);
    const folder = folderOf(dataDirectory);
    const taken = join(folder, 'comprobantes.danada-2026-11-26-120000.db-journal');

    await openStore(dataDirectory, { backups: OFF }).save(record(1));
    writeFileSync(file, 'x'.repeat(600));
    makeOld(file);
    writeFileSync(taken, 'de otro');

    const outcome = await openStore(dataDirectory, { backups: OFF }).save(NEXT);

    expect(basename(String(outcome.recovered?.setAside))).toBe('comprobantes.danada-2026-11-26-120000-2.db');
    expect(readFileSync(taken, 'utf8')).toBe('de otro');
    expect(existsSync(join(folder, 'comprobantes.danada-2026-11-26-120000.db'))).toBe(false);
  });
});
