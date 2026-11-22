/**
 * Escribe `docs/assets/iconos/*.svg` desde `site/src/icons.ts` y pone los títulos del README con su ícono:
 *   yarn docs:readme-iconos                 # URLs a main (lo que se publica)
 *   yarn docs:readme-iconos --ref <rama>    # URLs a una rama, para ver el README en GitHub antes de mergear
 * `scripts/docs/readme-iconos.test.ts` falla si quedaron desactualizados.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { applyHeadings, DEFAULT_REF, ICONS_DIR, renderIcons } from './readme-iconos';

const root = new URL('../../', import.meta.url);
const dir = new URL(`${ICONS_DIR}/`, root);
const readmeFile = new URL('README.md', root);
const refIndex = process.argv.indexOf('--ref');
const ref = refIndex === -1 ? DEFAULT_REF : process.argv[refIndex + 1];

if (!ref) throw new Error('Falta la rama después de --ref.');

const files = renderIcons();

mkdirSync(dir, { recursive: true });

for (const file of readdirSync(dir)) {
  if (file.endsWith('.svg') && !files.has(file)) rmSync(new URL(file, dir));
}

for (const [file, svg] of files) writeFileSync(new URL(file, dir), svg);

writeFileSync(readmeFile, applyHeadings(readFileSync(readmeFile, 'utf8'), ref));

console.log(`${ICONS_DIR}: ${files.size} íconos; README.md con URLs a ${ref}.`);
