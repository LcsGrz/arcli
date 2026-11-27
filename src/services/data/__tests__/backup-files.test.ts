import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { pruneMigrationBackups } from '../backup-files';

import { NOW, temporaryDataDirectory } from './local-data.fixtures';

/**
 * La retención de las copias de antes de migrar (revisión de #318): la aplica quien migró, entre las anotadas en
 * `migraciones.copia`, y no borra la de otro proceso que todavía está migrando.
 */
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
      { folder, prefix: 'comprobantes' },
      new Set([names.anotadaNueva, names.anotadaMedia, names.anotadaVieja]),
      new Date(NOW),
    );

    expect(readdirSync(folder).sort()).toEqual([names.anotadaMedia, names.anotadaNueva, names.enVuelo].sort());
  });
});
