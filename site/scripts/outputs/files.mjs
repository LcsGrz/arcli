import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { siteDir } from '../lib/paths.mjs';

/** Escribe un archivo creando su carpeta. */
export function writeFile(target, text) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

/** Escribe en `public/` (se sirve tal cual, en la raiz del sitio). */
export function writePublic(path, text) {
  writeFile(join(siteDir, 'public', path), text);
}

/** Escribe en `src/generated/` (lo importan los componentes de Astro). */
export function writeGenerated(name, data) {
  writeFile(join(siteDir, 'src/generated', name), `${JSON.stringify(data, null, 2)}\n`);
}
