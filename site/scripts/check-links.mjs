/**
 * Revisa el sitio ya construido (`dist/`): cada link interno apunta a una pagina o archivo que existe y, si lleva
 * ancla, a un titulo que existe en esa pagina. Corre despues de `astro build`; falla si encuentra alguno roto.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = '/arcli/';
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    return statSync(path).isDirectory() ? htmlFiles(path) : path.endsWith('.html') ? [path] : [];
  });
}

const ids = new Map();
const idsOf = (file) => {
  if (!ids.has(file)) {
    ids.set(file, new Set([...readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])));
  }

  return ids.get(file);
};

const broken = [];

for (const file of htmlFiles(dist)) {
  const html = readFileSync(file, 'utf8');

  for (const [, raw] of html.matchAll(/(?:href|src)="(\/arcli\/[^"]*)"/g)) {
    const href = raw.replaceAll('&amp;', '&');
    const [path, anchor] = href.split('#');
    const relative = decodeURIComponent(path.slice(BASE.length));
    const target = relative === '' || relative.endsWith('/') ? join(dist, relative, 'index.html') : join(dist, relative);

    if (!existsSync(target)) {
      broken.push(`${file.slice(dist.length)}: ${href} (no existe)`);
    } else if (anchor && target.endsWith('.html') && !idsOf(target).has(decodeURIComponent(anchor))) {
      broken.push(`${file.slice(dist.length)}: ${href} (no existe el ancla)`);
    }
  }
}

if (broken.length > 0) {
  console.error([...new Set(broken)].join('\n'));
  console.error(`\n${new Set(broken).size} links rotos.`);
  process.exit(1);
}

console.log('Links internos: todos bien.');
