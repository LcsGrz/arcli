/**
 * Escribe `docs/comprobantes/*.md` desde `comprobantes.ts`:
 *   yarn docs:comprobantes
 * `scripts/docs/comprobantes-docs.test.ts` falla si quedaron desactualizados.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

import { renderAll } from './comprobantes-md';

const dir = new URL('../../docs/comprobantes/', import.meta.url);
const files = renderAll();

mkdirSync(dir, { recursive: true });

for (const file of readdirSync(dir)) {
  if (file.endsWith('.md') && !files.has(file)) rmSync(new URL(file, dir));
}

for (const [file, text] of files) writeFileSync(new URL(file, dir), text);

console.log(`docs/comprobantes: ${files.size} páginas.`);
