import { closeSync, fstatSync, openSync, truncateSync, writeFileSync, writeSync } from 'node:fs';

import {
  cutFile,
  inspect,
  makeOld,
  openStore,
  scalar,
  temporaryDataDirectory,
  voucherRecord,
  vouchersFile,
} from './local-data.fixtures';

/**
 * Bases dañadas armadas en el test (ARQ-12 PR 4b), desde una base sana de ARCLI: la cabecera rota, cortada, otro
 * formato, una página del medio rota que solo ve `quick_check`. Lo compartido por damaged-database*.test.ts.
 */

/** El nombre de la dañada apartada: `comprobantes.danada-<fecha>….db` (fecha del reloj fijo, NOW). */
export const DAMAGED_NAME = /^comprobantes\.danada-2026-11-26.*\.db$/;

/** Un comprobante ficticio por número. */
export const record = (numero: number) => voucherRecord({ cae: String(76_000_000_000_000 + numero), numero });
export const cae = (numero: number) => String(76_000_000_000_000 + numero);

function overwrite(file: string, bytes: Buffer, position: number): void {
  const descriptor = openSync(file, 'r+');

  try {
    writeSync(descriptor, bytes, 0, bytes.length, position);
  } finally {
    closeSync(descriptor);
  }
}

/** Una página del medio con basura: la cabecera está bien y una consulta suelta anda; solo `quick_check` la ve. */
function breakMiddlePage(file: string): void {
  const pageSize = Number(inspect(file, (database) => scalar(database, 'PRAGMA page_size')));
  const descriptor = openSync(file, 'r+');

  try {
    const pages = fstatSync(descriptor).size / pageSize;

    writeSync(descriptor, Buffer.alloc(pageSize, 0x41), 0, pageSize, pageSize * Math.floor(pages / 2));
  } finally {
    closeSync(descriptor);
  }
}

export const DAMAGES: readonly (readonly [string, (file: string) => void])[] = [
  ['con la cabecera rota', (file) => overwrite(file, Buffer.from('SQLite format 2\0', 'latin1'), 0)],
  ['vacía (0 bytes)', (file) => truncateSync(file, 0)],
  ['de 1 byte', (file) => writeFileSync(file, 'x')],
  ['cortada a la mitad', (file) => cutFile(file, (size) => Math.floor(size / 2))],
  ['cortada a 100 bytes', (file) => truncateSync(file, 100)],
  ['con una página del medio rota', breakMiddlePage],
  ['un JSON', (file) => writeFileSync(file, JSON.stringify({ relleno: 'x'.repeat(600) }))],
  ['un zip', (file) => writeFileSync(file, Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(1020)]))],
];

/**
 * Una base sana con los comprobantes 1 y 2 y bastantes eventos (para que tenga páginas en el medio), sin copias.
 * Después `damage` la rompe y queda con fecha vieja: no es una base que otro proceso esté creando.
 */
export async function damagedBase(
  damage: (file: string) => void,
): Promise<{ readonly dataDirectory: string; readonly file: string }> {
  const dataDirectory = temporaryDataDirectory();
  const file = vouchersFile(dataDirectory);

  for (const numero of [1, 2]) {
    await openStore(dataDirectory, { backups: { enabled: false } }).save(record(numero));
  }

  inspect(file, (database) => {
    const insert = database.prepare(
      "INSERT INTO eventos (tipo, ocurrido_el, version_arcli, datos) VALUES ('relleno', '2026-11-26T15:00:00.000Z', 'x', NULL)",
    );

    database.exec('BEGIN IMMEDIATE');

    for (let index = 0; index < 3000; index += 1) {
      insert.run();
    }

    database.exec('COMMIT');
  });

  damage(file);
  makeOld(file);

  return { dataDirectory, file };
}

/** El evento `base-repuesta` de la base nueva, con SQLite crudo. */
export function restoredEvents(file: string): { cae: unknown; datos: string }[] {
  return inspect(file, (database) =>
    database
      .prepare("SELECT cae, datos FROM eventos WHERE tipo = 'base-repuesta'")
      .all()
      .map((row) => ({ cae: row.cae, datos: String(row.datos) })),
  );
}
