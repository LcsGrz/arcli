import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

import { toWebp } from '../lib/images.mjs';
import { repoDir, siteDir } from '../lib/paths.mjs';

/** Los WebP ya hechos, por el hash del original: `yarn dev` no los vuelve a generar si la imagen no cambio. */
const cacheDir = join(siteDir, 'node_modules/.cache/arcli-webp');

/**
 * Copia las imagenes de `docs/assets` a `public/assets` (sin los videos) y el icono al logo del menu y al favicon.
 * De cada PNG y GIF agrega su WebP sin perdida (los GIF, animado), que es el que usan las paginas (`toWebp`).
 */
export async function copyAssets(folders) {
  const assetsDir = join(siteDir, 'public/assets');

  rmSync(assetsDir, { force: true, recursive: true });

  for (const folder of folders) {
    const from = join(repoDir, 'docs/assets', folder);

    if (existsSync(from)) {
      cpSync(from, join(assetsDir, folder), { filter: (path) => !path.endsWith('.mp4'), recursive: true });
      await Promise.all(
        readdirSync(from)
          .filter((name) => /\.(?:png|gif)$/.test(name))
          .map((name) => writeWebp(join(from, name), join(assetsDir, folder, toWebp(name)))),
      );
    }
  }

  // El logo del menu tiene que estar en src para que Astro lo procese.
  mkdirSync(join(siteDir, 'src/assets'), { recursive: true });
  cpSync(join(repoDir, 'docs/assets/imagenes/arcliIcon.svg'), join(siteDir, 'src/assets/logo.svg'));
  cpSync(join(repoDir, 'docs/assets/imagenes/arcliIcon.svg'), join(siteDir, 'public/favicon.svg'));
}

async function writeWebp(source, target) {
  const input = readFileSync(source);
  const cached = join(cacheDir, `${createHash('sha1').update(input).digest('hex')}.webp`);

  if (!existsSync(cached)) {
    mkdirSync(cacheDir, { recursive: true });
    // Sin `limitInputPixels`: un GIF se lee con todos sus cuadros apilados y pasa el limite de sharp.
    await sharp(input, { animated: true, limitInputPixels: false }).webp({ effort: 4, lossless: true }).toFile(cached);
  }

  cpSync(cached, target);
}
