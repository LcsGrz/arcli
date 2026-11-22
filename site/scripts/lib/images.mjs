import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BASE, repoDir } from './paths.mjs';

/** Ancho y alto de los primeros bytes de un PNG, GIF o WebP; `null` si no es ninguno. */
export function headerSize(head) {
  if (head.toString('ascii', 1, 4) === 'PNG') return { height: head.readUInt32BE(20), width: head.readUInt32BE(16) };
  if (head.toString('ascii', 0, 3) === 'GIF') return { height: head.readUInt16LE(8), width: head.readUInt16LE(6) };
  if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WEBP') return null;

  const chunk = head.toString('ascii', 12, 16);

  if (chunk === 'VP8X') return { height: 1 + head.readUIntLE(27, 3), width: 1 + head.readUIntLE(24, 3) };
  if (chunk === 'VP8L') {
    const bits = head.readUInt32LE(21);

    return { height: 1 + ((bits >> 14) & 0x3fff), width: 1 + (bits & 0x3fff) };
  }
  if (chunk === 'VP8 ') return { height: head.readUInt16LE(28) & 0x3fff, width: head.readUInt16LE(26) & 0x3fff };

  return null;
}

/** Ancho y alto de una imagen de `docs/assets`, leidos del archivo; `null` si no se puede. */
export function imageSize(url) {
  const file = url.startsWith(`${BASE}/assets/`) ? join(repoDir, 'docs', url.slice(BASE.length + 1)) : null;

  if (!file || !existsSync(file)) return null;

  return headerSize(readFileSync(file).subarray(0, 32));
}

/**
 * En el sitio, cada PNG y GIF de `docs/assets` se sirve tambien en WebP sin perdida (`outputs/assets.mjs`): los
 * mismos pixeles y cuadros, con la mitad o menos de peso. `docs/` sigue apuntando al PNG o al GIF, que es lo que ve
 * GitHub.
 */
export const toWebp = (url) => url.replace(/\.(?:png|gif)$/, '.webp');
