import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { repoDir, siteDir } from '../lib/paths.mjs';

/** Copia las imagenes de `docs/assets` a `public/assets` (sin los videos) y el icono al logo del menu y al favicon. */
export function copyAssets(folders) {
  const assetsDir = join(siteDir, 'public/assets');

  rmSync(assetsDir, { force: true, recursive: true });

  for (const folder of folders) {
    const from = join(repoDir, 'docs/assets', folder);

    if (existsSync(from)) {
      cpSync(from, join(assetsDir, folder), { filter: (path) => !path.endsWith('.mp4'), recursive: true });
    }
  }

  // El logo del menu tiene que estar en src para que Astro lo procese.
  mkdirSync(join(siteDir, 'src/assets'), { recursive: true });
  cpSync(join(repoDir, 'docs/assets/imagenes/arcliIcon.svg'), join(siteDir, 'src/assets/logo.svg'));
  cpSync(join(repoDir, 'docs/assets/imagenes/arcliIcon.svg'), join(siteDir, 'public/favicon.svg'));
}
