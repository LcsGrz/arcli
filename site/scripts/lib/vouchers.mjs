/**
 * Lee las paginas de `docs/comprobantes/` (las genera `yarn docs:comprobantes` desde `scripts/docs/comprobantes.ts`):
 * el titulo, la marca `<!-- arcli: familia=... icono=... orden=... -->` y la linea de comandos (`arcli fc` |
 * `arcli factura c`). Las usan el menu (`pages.mjs`) y `generated/comprobantes.json` (la portada).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoDir } from './paths.mjs';

export const VOUCHER_DIR = 'docs/comprobantes';

/** Un comprobante desde su `.md`; falla si le falta algo. */
export function parseVoucher(file, text) {
  const meta = text.match(/<!-- arcli: familia="([^"]+)" icono="([^"]+)" orden="(\d+)" -->/);
  const title = text.match(/^# (.+)$/m);
  const commands = text.match(/^`arcli ([a-z]+)` \| `arcli ([a-z-]+) ([a-z])`$/m);

  if (!meta || !title || !commands) {
    throw new Error(`${VOUCHER_DIR}/${file}: falta el título, el comentario de la familia o la línea de comandos.`);
  }

  return {
    atajo: commands[1],
    comando: commands[2],
    familia: meta[1],
    icono: meta[2],
    letra: commands[3],
    orden: Number(meta[3]),
    slug: file.replace(/\.md$/, ''),
    titulo: title[1],
  };
}

/** Todos los comprobantes de `docs/comprobantes/`, en el orden de la marca. */
export function readVouchers(dir = join(repoDir, VOUCHER_DIR)) {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .map((file) => parseVoucher(file, readFileSync(join(dir, file), 'utf8')))
    .sort((a, b) => a.orden - b.orden);
}
