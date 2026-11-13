/**
 * Genera las paginas del sitio desde `docs/`, `README.md` y `CHANGELOG.md`, que siguen siendo la unica fuente: los
 * links de GitHub que ya circulan no se rompen y los tests de docs del CLI no cambian.
 *
 * Por cada pagina: titulo del primer `#` al frontmatter, links entre docs a la URL del sitio, links a archivos que no
 * estan en el sitio a GitHub, imagenes a `public/assets` y "Editar esta pagina" al archivo original en `dev`.
 * Lo generado esta en `.gitignore`; las paginas propias del sitio (como `index.mdx`) no se tocan.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = join(siteDir, '..');
const contentDir = join(siteDir, 'src/content/docs');

/** Tiene que coincidir con `base` de astro.config.mjs. */
export const BASE = '/arcli';
const REPO = 'https://github.com/LcsGrz/arcli';

/** Secciones generadas: se borran y se vuelven a escribir en cada corrida. */
const GENERATED_SECTIONS = ['empezar', 'guias', 'referencia', 'ayuda'];

/**
 * Que pagina sale de cada archivo. `label` es el nombre corto del menu; sin el, el titulo del documento.
 * El orden del menu es el de esta lista dentro de cada seccion.
 */
const PAGES = [
  { label: 'Instalar y configurar', slug: 'empezar/instalar', src: 'README.md', title: 'Instalar y configurar arcli' },
  { label: 'Obtener el certificado', slug: 'empezar/certificados', src: 'docs/obtencion-certificados.md' },
  { label: 'Modo interactivo', slug: 'empezar/modo-interactivo', src: 'docs/modo-interactivo.md' },
  { label: 'Cómo funciona', slug: 'empezar/como-funciona', src: 'docs/mental-model.md' },
  { label: 'Patrones de uso', slug: 'guias/patrones-de-uso', src: 'docs/usage-patterns.md' },
  { label: 'PDF de comprobantes', slug: 'guias/pdf', src: 'docs/pdf.md' },
  { label: 'Comandos y flags', slug: 'referencia/comandos', src: 'docs/cli-reference.md' },
  { label: 'Configuración', slug: 'referencia/configuracion', src: 'docs/configuration.md' },
  { label: 'Entrada y salida (JSON)', slug: 'referencia/entrada-y-salida', src: 'docs/input-output.md' },
  { label: 'Reglas de validación', slug: 'referencia/validaciones', src: 'docs/validation-rules.md' },
  { label: 'Glosario', slug: 'referencia/glosario', src: 'docs/glossary.md' },
  { label: 'Limitaciones', slug: 'referencia/limitaciones', src: 'docs/limitations.md' },
  { label: 'Problemas frecuentes', slug: 'ayuda/problemas-frecuentes', src: 'docs/troubleshooting.md' },
  { label: 'Novedades', slug: 'ayuda/novedades', src: 'CHANGELOG.md', title: 'Novedades de cada versión' },
];

/** Del README solo van las secciones para quien usa arcli; el resto (desarrollo, licencia...) queda en GitHub. */
const README_FIRST_SECTION = '## Empezar sin saber de terminal';
const README_END_SECTION = '## Documentación';

/** Carpetas de `docs/assets` que usan las paginas (las cintas de VHS no). */
const ASSET_FOLDERS = ['certificados', 'demo', 'imagenes'];

const bySource = new Map(PAGES.map((page) => [page.src, page]));

/** Anclas de GitHub y de Astro: las dos usan github-slugger, asi que alcanza con conservarlas. */
function pageUrl(page, anchor) {
  return `${BASE}/${page.slug}/${anchor ? `#${anchor}` : ''}`;
}

/** Los anchors del README que quedan en la pagina "Instalar"; los demas van al README en GitHub. */
function readmeAnchors(text) {
  const slug = (heading) =>
    heading
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s/g, '-');

  return new Set([...text.matchAll(/^#{2,6} (.+)$/gm)].map((match) => slug(match[1])));
}

/** A donde apunta un link relativo de `src`: pagina del sitio, archivo en GitHub o lo deja igual. */
function rewriteTarget(src, target, includedReadmeAnchors) {
  if (/^(https?:|mailto:|#)/.test(target)) {
    const github = target.match(/^https:\/\/github\.com\/LcsGrz\/arcli\/blob\/main\/([^#?]+)(?:#(.*))?$/);

    return github ? rewriteTarget('', github[1], includedReadmeAnchors).replace(/#$/, '') + (github[2] ? `#${github[2]}` : '') : target;
  }

  const [path, anchor] = target.split('#');
  const resolved = posix.normalize(posix.join(posix.dirname(src), path));

  if (resolved === 'docs/README.md') {
    return `${BASE}/`;
  }

  if (resolved === 'README.md' && anchor && !includedReadmeAnchors.has(anchor)) {
    return `${REPO}/blob/main/README.md#${anchor}`;
  }

  const page = bySource.get(resolved);

  if (page) {
    return pageUrl(page, anchor);
  }

  if (resolved.startsWith('docs/assets/')) {
    return `${BASE}/${resolved.slice('docs/'.length)}`;
  }

  return `${REPO}/blob/main/${resolved}${anchor ? `#${anchor}` : ''}`;
}

/** Reescribe links e imagenes fuera de los bloques de codigo. */
function rewriteLinks(src, text, includedReadmeAnchors) {
  const parts = text.split(/(^```[\s\S]*?^```)/m);

  return parts
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .replace(/(!?\[[^\]]*\]\()([^)\s]+)(\))/g, (_, open, target, close) => open + rewriteTarget(src, target, includedReadmeAnchors) + close)
            .replace(/(<img\s[^>]*src=")([^"]+)(")/g, (_, open, target, close) => open + rewriteTarget(src, target, includedReadmeAnchors) + close),
    )
    .join('');
}

function frontmatter(page, title) {
  const quote = (value) => JSON.stringify(value);
  const order = PAGES.filter((other) => other.slug.split('/')[0] === page.slug.split('/')[0]).indexOf(page) + 1;

  return [
    '---',
    `title: ${quote(title)}`,
    `editUrl: ${quote(`${REPO}/edit/dev/${page.src}`)}`,
    'sidebar:',
    `  label: ${quote(page.label ?? title)}`,
    `  order: ${order}`,
    '---',
    '',
  ].join('\n');
}

/** Saca el `#` (va al frontmatter) y la linea de "Volver al README", que en el sitio sobra. */
function extractBody(page, raw) {
  let text = raw.replace(/\r\n/g, '\n');

  if (page.src === 'README.md') {
    const start = text.indexOf(README_FIRST_SECTION);
    const end = text.indexOf(README_END_SECTION);

    if (start === -1 || end === -1) {
      throw new Error(`README.md: no encontre "${README_FIRST_SECTION}" o "${README_END_SECTION}".`);
    }

    return { body: text.slice(start, end).trim(), title: page.title };
  }

  text = text.replace(/^\[←[^\n]*\n+/m, '');
  const heading = text.match(/^# (.+)\n+/m);

  if (!heading) {
    throw new Error(`${page.src}: falta el título (# ...).`);
  }

  return { body: text.replace(heading[0], '').trim(), title: page.title ?? heading[1].trim() };
}

/**
 * El logo ASCII y la version salen del CLI (`renderLogo.ts` y `package.json`), para que la portada muestre lo mismo
 * que la terminal sin copiarlo a mano.
 */
function writeBrand() {
  const logoSource = readFileSync(join(repoDir, 'src/ui/primitives/renderLogo.ts'), 'utf8');
  const block = logoSource.match(/ARCLI_ASCII_BANNER = \[([\s\S]*?)\]\.join/);
  const split = logoSource.match(/ARCLI_BANNER_AR_CLI_SPLIT_COLUMN = (\d+)/);

  if (!block || !split) {
    throw new Error('renderLogo.ts: no encontre ARCLI_ASCII_BANNER o ARCLI_BANNER_AR_CLI_SPLIT_COLUMN.');
  }

  const banner = [...block[1].matchAll(/'([^']*)'/g)].map((match) => match[1].replace(/\s+$/, ''));
  const { version } = JSON.parse(readFileSync(join(repoDir, 'package.json'), 'utf8'));
  const target = join(siteDir, 'src/generated/brand.json');

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify({ banner, splitColumn: Number(split[1]), version }, null, 2)}\n`);
}

function sync() {
  for (const section of GENERATED_SECTIONS) {
    rmSync(join(contentDir, section), { force: true, recursive: true });
  }

  const readme = readFileSync(join(repoDir, 'README.md'), 'utf8');
  const includedReadmeAnchors = readmeAnchors(
    readme.slice(readme.indexOf(README_FIRST_SECTION), readme.indexOf(README_END_SECTION)),
  );

  for (const page of PAGES) {
    const { body, title } = extractBody(page, readFileSync(join(repoDir, page.src), 'utf8'));
    const target = join(contentDir, `${page.slug}.md`);

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${frontmatter(page, title)}\n${rewriteLinks(page.src, body, includedReadmeAnchors)}\n`);
  }

  const assetsDir = join(siteDir, 'public/assets');

  rmSync(assetsDir, { force: true, recursive: true });

  for (const folder of ASSET_FOLDERS) {
    const from = join(repoDir, 'docs/assets', folder);

    if (existsSync(from)) {
      cpSync(from, join(assetsDir, folder), { filter: (path) => !path.endsWith('.mp4'), recursive: true });
    }
  }

  // El logo del menu tiene que estar en src para que Astro lo procese.
  mkdirSync(join(siteDir, 'src/assets'), { recursive: true });
  cpSync(join(repoDir, 'docs/assets/imagenes/arcliIcon.svg'), join(siteDir, 'src/assets/logo.svg'));
  cpSync(join(repoDir, 'docs/assets/imagenes/arcliIcon.svg'), join(siteDir, 'public/favicon.svg'));

  writeBrand();

  console.log(`Sitio: ${PAGES.length} páginas generadas desde docs/.`);
}

sync();
