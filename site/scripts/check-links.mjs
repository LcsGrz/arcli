/**
 * Revisa el sitio ya construido (`dist/`): cada link interno apunta a una pagina o archivo que existe y, si lleva
 * ancla, a un titulo que existe en esa pagina. Tambien que cada pagina tenga su propia descripcion (meta y vista previa
 * al compartir) de hasta 160 caracteres: sin `description`, Starlight pone la del sitio y quedaria repetida.
 * Corre despues de `astro build`; falla si encuentra algun problema.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const descriptions = new Map();
const decodeEntities = (text) =>
  text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

for (const file of htmlFiles(dist)) {
  const html = readFileSync(file, 'utf8');
  const page = file.slice(dist.length);
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1];

  if (page !== '/404.html') {
    const text = decodeEntities(description ?? '');

    if (!text) broken.push(`${page}: no tiene descripción`);
    else if ([...text].length > 160) broken.push(`${page}: la descripción pasa de 160 caracteres`);
    else if (descriptions.has(text)) broken.push(`${page}: la misma descripción que ${descriptions.get(text)}`);
    else descriptions.set(text, page);
  }

  for (const [, raw] of html.matchAll(/(?:href|src)="(\/(?!\/)[^"]*)"/g)) {
    const href = raw.replaceAll('&amp;', '&');
    const [path, anchor] = href.split('#');
    const relative = decodeURIComponent(path.slice(1));
    const target =
      relative === '' || relative.endsWith('/') ? join(dist, relative, 'index.html') : join(dist, relative);

    if (!existsSync(target)) {
      broken.push(`${file.slice(dist.length)}: ${href} (no existe)`);
    } else if (anchor && target.endsWith('.html') && !idsOf(target).has(decodeURIComponent(anchor))) {
      broken.push(`${file.slice(dist.length)}: ${href} (no existe el ancla)`);
    }
  }
}

if (broken.length > 0) {
  console.error([...new Set(broken)].join('\n'));
  console.error(`\n${new Set(broken).size} problemas.`);
  process.exit(1);
}

console.log('Links internos y descripciones: todos bien.');
