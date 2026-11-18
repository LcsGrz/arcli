import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BASE, repoDir } from './paths.mjs';

/** Ancho y alto de un PNG o GIF de `docs/assets`, leidos del archivo; `null` si no se puede. */
export function imageSize(url) {
  const file = url.startsWith(`${BASE}/assets/`) ? join(repoDir, 'docs', url.slice(BASE.length + 1)) : null;

  if (!file || !existsSync(file)) return null;

  const head = readFileSync(file).subarray(0, 32);

  if (head.toString('ascii', 1, 4) === 'PNG') return { height: head.readUInt32BE(20), width: head.readUInt32BE(16) };
  if (head.toString('ascii', 0, 3) === 'GIF') return { height: head.readUInt16LE(8), width: head.readUInt16LE(6) };

  return null;
}
