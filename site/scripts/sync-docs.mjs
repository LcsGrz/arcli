/**
 * Genera las paginas del sitio desde `docs/`, `README.md` y `CHANGELOG.md`, que siguen siendo la unica fuente: los
 * links de GitHub que ya circulan no se rompen y los tests de docs del CLI no cambian.
 *
 * Por cada pagina: titulo del primer `#` al frontmatter, links entre docs a la URL del sitio, links a archivos que no
 * estan en el sitio a GitHub, imagenes a `public/assets` y "Editar esta pagina" al archivo original en `dev`.
 * Lo generado esta en `.gitignore`; las paginas propias del sitio (como `index.mdx`) no se tocan.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = join(siteDir, '..');
const contentDir = join(siteDir, 'src/content/docs');

/** Prefijo de los links internos: el sitio esta en la raiz de arcli.com.ar (astro.config.mjs no tiene `base`). */
export const BASE = '';
const REPO = 'https://github.com/LcsGrz/arcli';

/** Secciones generadas: se borran y se vuelven a escribir en cada corrida. */
const GENERATED_SECTIONS = ['empezar', 'uso', 'comprobantes', 'mas', 'referencia', 'ayuda'];

/** Las secciones del menu, en orden, con su nombre y la entrada del encabezado. */
const SECTIONS = [
  { dir: 'empezar', label: 'Empezar' },
  { dir: 'uso', label: 'Formas de uso' },
  { dir: 'comprobantes', label: 'Comprobantes' },
  { dir: 'mas', label: 'Más' },
  { dir: 'referencia', label: 'Referencia' },
  { dir: 'ayuda', label: 'Ayuda' },
];

/**
 * Las paginas de `docs/comprobantes/` (las genera `yarn docs:comprobantes`): primero "¿Cuál me toca?" y despues una por
 * comprobante, agrupadas por familia en el orden del comentario `<!-- arcli: familia=... orden=... -->`.
 */
function voucherPages() {
  const dir = 'docs/comprobantes';
  const pages = readdirSync(join(repoDir, dir))
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .map((file) => {
      const text = readFileSync(join(repoDir, dir, file), 'utf8');
      const meta = text.match(/<!-- arcli: familia="([^"]+)" icono="([^"]+)" orden="(\d+)" -->/);
      const title = text.match(/^# (.+)$/m);

      if (!meta || !title) throw new Error(`${dir}/${file}: falta el título o el comentario de la familia.`);

      return {
        group: meta[1],
        icon: meta[2],
        label: title[1],
        order: Number(meta[3]),
        slug: `comprobantes/${file.replace(/\.md$/, '')}`,
        src: `${dir}/${file}`,
      };
    })
    .sort((a, b) => a.order - b.order);

  return [
    { icon: 'pregunta', label: '¿Cuál me toca?', slug: 'comprobantes/cual-me-toca', src: `${dir}/README.md` },
    ...pages,
  ];
}

/**
 * Que pagina sale de cada archivo. `label` es el nombre corto del menu; sin el, el titulo del documento.
 * El orden del menu es el de esta lista dentro de cada seccion.
 */
const PAGES = [
  { icon: 'descarga', label: 'Instalar y configurar', slug: 'empezar/instalar', src: 'docs/instalar.md' },
  {
    icon: 'frasco',
    label: 'Certificado de testing',
    slug: 'empezar/certificado-testing',
    src: 'docs/certificado-testing.md',
  },
  {
    icon: 'escudo',
    label: 'Certificado de producción',
    slug: 'empezar/certificado-produccion',
    src: 'docs/certificado-produccion.md',
  },
  {
    hidden: true,
    label: 'Certificado de testing: guía completa',
    slug: 'empezar/certificado-testing-completo',
    src: 'docs/certificado-testing-completa.md',
  },
  {
    hidden: true,
    label: 'Certificado de producción: guía completa',
    slug: 'empezar/certificado-produccion-completo',
    src: 'docs/certificado-produccion-completa.md',
  },
  { icon: 'flechas', label: 'Cambiar de entorno', slug: 'empezar/entornos', src: 'docs/entornos.md' },
  { icon: 'capas', label: 'Cómo funciona', slug: 'empezar/como-funciona', src: 'docs/mental-model.md' },
  { icon: 'chat', label: 'Asistente', slug: 'uso/asistente', src: 'docs/formas-de-uso/asistente.md' },
  { icon: 'terminal', label: 'Comandos', slug: 'uso/comandos', src: 'docs/formas-de-uso/comandos.md' },
  { icon: 'chispa', label: 'Con IA', slug: 'uso/con-ia', src: 'docs/formas-de-uso/con-ia.md' },
  // Las guías completas: no van en el menú, se llega desde el link al final de la versión corta.
  { hidden: true, label: 'Modo interactivo', slug: 'uso/asistente-completo', src: 'docs/modo-interactivo.md' },
  { hidden: true, label: 'Automatizar con IA', slug: 'uso/con-ia-completo', src: 'docs/automatizar-con-ia.md' },
  ...voucherPages(),
  {
    group: 'Explicaciones',
    icon: 'libro',
    label: 'Cómo funcionan las notas',
    slug: 'comprobantes/notas',
    src: 'docs/notas-credito-debito.md',
  },
  { group: 'Explicaciones', icon: 'libro', label: 'Qué es la FCE', slug: 'comprobantes/fce', src: 'docs/fce.md' },
  {
    group: 'Explicaciones',
    icon: 'libro',
    label: 'Exportación paso a paso',
    slug: 'comprobantes/exportacion',
    src: 'docs/exportacion.md',
  },
  { icon: 'lupa', label: 'Consultas sin emitir', slug: 'mas/consultas', src: 'docs/consultas.md' },
  { icon: 'pdf', label: 'PDF de comprobantes', slug: 'mas/pdf', src: 'docs/pdf-en-corto.md' },
  { hidden: true, label: 'PDF de comprobantes: guía completa', slug: 'mas/pdf-completo', src: 'docs/pdf.md' },
  { icon: 'pila', label: 'Lotes y JSON', slug: 'mas/lotes-y-json', src: 'docs/lotes-y-json.md' },
  { icon: 'lista', label: 'Comandos y flags', slug: 'referencia/comandos', src: 'docs/comandos.md' },
  {
    hidden: true,
    label: 'Referencia completa del CLI',
    slug: 'referencia/comandos-completo',
    src: 'docs/cli-reference.md',
  },
  { icon: 'ajustes', label: 'Configuración', slug: 'referencia/configuracion', src: 'docs/configuration.md' },
  {
    icon: 'llaves',
    label: 'Entrada y salida (JSON)',
    slug: 'referencia/entrada-y-salida',
    src: 'docs/input-output.md',
  },
  { icon: 'check', label: 'Reglas de validación', slug: 'referencia/validaciones', src: 'docs/validation-rules.md' },
  { icon: 'glosario', label: 'Glosario', slug: 'referencia/glosario', src: 'docs/glossary.md' },
  { icon: 'alerta', label: 'Limitaciones', slug: 'referencia/limitaciones', src: 'docs/limitations.md' },
  { icon: 'llave', label: 'Problemas frecuentes', slug: 'ayuda/problemas-frecuentes', src: 'docs/troubleshooting.md' },
  {
    icon: 'campana',
    label: 'Novedades',
    slug: 'ayuda/novedades',
    src: 'CHANGELOG.md',
    title: 'Novedades de cada versión',
  },
];

/**
 * Archivos que quedaron como indice en docs/ (para no romper los links de GitHub que ya circulan, y los que imprimen
 * las versiones publicadas del CLI): en el sitio, sus links van a la pagina que tiene el contenido.
 */
const ALIASES = {
  'docs/obtencion-certificados.md': 'docs/certificado-testing.md',
  'docs/usage-patterns.md': 'docs/comprobantes/README.md',
};

/** Avisos de GitHub (`> [!TIP]`) a los de Starlight (`:::tip`): en GitHub se ven bien y en el sitio, con color. */
const ALERT_KINDS = { CAUTION: 'danger', IMPORTANT: 'note', NOTE: 'note', TIP: 'tip', WARNING: 'caution' };

/** Del README solo van las secciones para quien usa arcli; el resto (desarrollo, licencia...) queda en GitHub. */
const README_FIRST_SECTION = '## Empezar sin saber de terminal';
const README_END_SECTION = '## Documentación';

/** Carpetas de `docs/assets` que usan las paginas (las cintas de VHS no). */
const ASSET_FOLDERS = ['certificados', 'demo', 'imagenes'];

/** Anclas del README que tienen su lugar en docs/instalar.md (la pagina "Instalar y configurar"). */
const README_TO_INSTALL = {
  '': '',
  configuración: 'configurar',
  'empezar-sin-saber-de-terminal': 'instalar-a-mano',
  instalación: 'instalar-a-mano',
  'instalar-o-actualizar-con-ia': 'con-un-asistente-de-ia',
};

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

    return github
      ? rewriteTarget('', github[1], includedReadmeAnchors).replace(/#$/, '') + (github[2] ? `#${github[2]}` : '')
      : target;
  }

  const [path, anchor] = target.split('#');
  const resolved = posix.normalize(posix.join(posix.dirname(src), path));

  if (resolved === 'docs/README.md') {
    return `${BASE}/`;
  }

  // Del README, la instalacion y la configuracion estan en "Instalar y configurar"; el resto queda en GitHub.
  if (resolved === 'README.md') {
    const local = README_TO_INSTALL[anchor ?? ''];

    return local === undefined
      ? `${REPO}/blob/main/README.md${anchor ? `#${anchor}` : ''}`
      : pageUrl(bySource.get('docs/instalar.md'), local);
  }

  // El punto de venta quedo en la guia de produccion; el resto del indice de certificados, en la de testing.
  const aliased =
    resolved === 'docs/obtencion-certificados.md' && anchor === 'punto-de-venta-para-web-service'
      ? 'docs/certificado-produccion-completa.md'
      : (ALIASES[resolved] ?? resolved);
  const page = bySource.get(aliased);

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
            .replace(
              /(!?\[[^\]]*\]\()([^)\s]+)(\))/g,
              (_, open, target, close) => open + rewriteTarget(src, target, includedReadmeAnchors) + close,
            )
            .replace(
              /(<img\s[^>]*src=")([^"]+)(")/g,
              (_, open, target, close) => open + rewriteTarget(src, target, includedReadmeAnchors) + close,
            ),
    )
    .join('');
}

function frontmatter(page, title, extra = {}) {
  const quote = (value) => JSON.stringify(value);
  const order = PAGES.filter((other) => other.slug.split('/')[0] === page.slug.split('/')[0]).indexOf(page) + 1;

  return [
    '---',
    `title: ${quote(title)}`,
    `editUrl: ${quote(`${REPO}/edit/dev/${page.src}`)}`,
    'sidebar:',
    `  label: ${quote(page.label ?? title)}`,
    `  order: ${order}`,
    ...Object.entries(extra).map(([key, value]) => `${key}: ${quote(value)}`),
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
async function githubStars() {
  try {
    const response = await fetch('https://api.github.com/repos/LcsGrz/arcli', { signal: AbortSignal.timeout(5000) });

    return response.ok ? (await response.json()).stargazers_count : null;
  } catch {
    return null;
  }
}

/**
 * El menu: una seccion por carpeta, en el orden de `SECTIONS`, y cada pagina con su icono (`data-icon`, lo dibuja
 * `Sidebar.astro`). Las paginas con `group` van juntas en un grupo plegable; "Monotributo · C" lleva la letra al lado.
 */
function writeSidebar() {
  const sidebar = SECTIONS.map(({ dir, label }) => {
    const items = [];

    for (const page of PAGES.filter((other) => other.slug.split('/')[0] === dir && !other.hidden)) {
      const link = { attrs: { 'data-icon': page.icon }, label: page.label ?? page.title, slug: page.slug };
      const last = items.at(-1);

      if (page.group && last?.items && last.label === page.group) last.items.push(link);
      else if (page.group) items.push({ collapsed: true, items: [link], label: page.group });
      else items.push(link);
    }

    return { items, label };
  }).filter((section) => section.items.length > 0);
  const target = join(siteDir, 'src/generated/sidebar.json');

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(sidebar, null, 2)}\n`);
}

function writeBrand(stars) {
  const logoSource = readFileSync(join(repoDir, 'src/ui/primitives/renderLogo.ts'), 'utf8');
  const block = logoSource.match(/ARCLI_ASCII_BANNER = \[([\s\S]*?)\]\.join/);
  const split = logoSource.match(/ARCLI_BANNER_AR_CLI_SPLIT_COLUMN = (\d+)/);

  if (!block || !split) {
    throw new Error('renderLogo.ts: no encontre ARCLI_ASCII_BANNER o ARCLI_BANNER_AR_CLI_SPLIT_COLUMN.');
  }

  const banner = [...block[1].matchAll(/'([^']*)'/g)].map((match) => match[1].replace(/\s+$/, ''));
  const { version } = JSON.parse(readFileSync(join(repoDir, 'package.json'), 'utf8'));
  // El prompt para instalar con IA, el mismo del README (la portada lo copia con un botón).
  const readme = readFileSync(join(repoDir, 'README.md'), 'utf8');
  const prompt = readme
    .slice(readme.indexOf('### Instalar o actualizar con IA'))
    .match(/```text\n([\s\S]*?)\n```/)?.[1];

  if (!prompt) {
    throw new Error('README.md: no encontré el prompt de "### Instalar o actualizar con IA".');
  }
  const target = join(siteDir, 'src/generated/brand.json');

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    `${JSON.stringify({ banner, installPrompt: prompt, splitColumn: Number(split[1]), stars, version }, null, 2)}\n`,
  );
}

/** Escribe en `public/` (se sirve tal cual, en la raiz del sitio). */
function writePublic(path, text) {
  const target = join(siteDir, 'public', path);

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

/**
 * El CHANGELOG sigue Keep a Changelog (`## [2.4.0] - 2026-11-08`, lo leen herramientas); en el sitio las fechas van en
 * formato argentino: `## 2.4.0 · 08/11/2026`.
 */
function argentineVersionDates(text) {
  return text
    .replace(/^## \[([^\]]+)\] - (\d{4})-(\d{2})-(\d{2})$/gm, '## $1 · $4/$3/$2')
    .replace(/^## \[Sin publicar\]$/m, '## Sin publicar');
}

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Markdown en linea (codigo y negrita) a HTML, para lo que va adentro de una tarjeta. */
const inlineHtml = (text) =>
  escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

/** Celdas de una fila de tabla, con `\|` adentro de una celda. */
const tableCells = (line) =>
  line
    .replace(/^\|\s*|\s*\|$/g, '')
    .split(/\s*(?<!\\)\|\s*/)
    .map((value) => value.replace(/\\\|/g, '|'));

/**
 * En `docs/comprobantes/`, cada `### Opción` (texto, tabla Largo | Corto | Qué es y `Ej.:`) despues de
 * `<!-- arcli: opciones=req|opt|run -->` pasa a una tarjeta: barra celeste lo obligatorio, lavanda lo opcional y gris lo
 * de ejecucion. Mas de 5 filas: se ven 4 y "Ver las N" muestra el resto.
 */
function optionCards(text) {
  return text.replace(/<!-- arcli: opciones=(req|opt|run) -->\n([\s\S]*?)(?=\n## |$)/g, (_, kind, block) => {
    const cards = block
      .split(/^### /m)
      .slice(1)
      .map((chunk) => {
        const lines = chunk.trim().split('\n');
        const name = lines.shift();
        const prose = lines.filter((line) => line && !line.startsWith('|') && !line.startsWith('Ej.:')).join(' ');
        const rows = lines
          .filter((line) => line.startsWith('|'))
          .slice(2)
          .map(tableCells);
        const ej = lines.find((line) => line.startsWith('Ej.:'))?.replace(/^Ej\.:\s*/, '') ?? '';
        const row = ([long, short, what]) =>
          `<div class="arcli-opt-row"><span class="l">${inlineHtml(long)}</span><span class="s">${inlineHtml(short)}</span><span class="w">${inlineHtml(what)}</span></div>`;
        const shown = rows.length > 5 ? rows.slice(0, 4) : rows;
        const rest =
          rows.length > 5
            ? `<details class="arcli-more"><summary>Ver las ${rows.length}</summary>${rows.slice(4).map(row).join('')}</details>`
            : '';

        return `<div class="arcli-opt arcli-opt-${kind}"><div class="arcli-opt-top"><b>${inlineHtml(name)}</b>${ej ? `<span class="arcli-ej">Ej.: ${inlineHtml(ej)}</span>` : ''}</div>${prose ? `<p>${inlineHtml(prose)}</p>` : ''}<div class="arcli-opt-rows">${shown.map(row).join('')}${rest}</div></div>`;
      });

    return `<div class="arcli-opts">${cards.join('')}</div>\n`;
  });
}

/** `<!-- arcli: chat -->` y una cita con **Vos:** y **Tu asistente:**: en el sitio, como una conversación. */
function chats(text) {
  return text.replace(/<!-- arcli: chat -->\n+((?:>.*\n?)+)/g, (_, quote) => {
    const messages = quote
      .split('\n')
      .map((line) => line.replace(/^>\s?/, '').trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^\*\*(Vos|Tu asistente):\*\*\s*(.*)$/);

        return match
          ? `<div class="arcli-msg ${match[1] === 'Vos' ? 'user' : 'bot'}"><span class="who">${match[1]}</span>${inlineHtml(match[2])}</div>`
          : '';
      })
      .join('');

    return `<div class="arcli-chat">${messages}</div>\n`;
  });
}

/**
 * `<!-- arcli: pasos -->` y despues `### 1. ...`, `### 2. ...` hasta el proximo `##`: en el sitio, pasos numerados con
 * una linea que los une. En GitHub se leen como subtitulos numerados.
 */
function steps(text) {
  return text.replace(/<!-- arcli: pasos -->\n([\s\S]*?)(?=\n## |$)/g, (_, block) => {
    // Un desplegable de capturas va envuelto, asi su borde no corta la linea que une los pasos.
    const body = block
      .trim()
      .replace(/^### \d+\. /gm, '### ')
      .replace(/^<details>[\s\S]*?^<\/details>/gm, (details) => `<div class="arcli-block">\n\n${details}\n\n</div>`)
      // Los avisos también, para que tengan el mismo espacio arriba y abajo.
      .replace(/^:::\w+(?:\[[^\]]*\])?\n[\s\S]*?^:::$/gm, (aside) => `<div class="arcli-block">\n\n${aside}\n\n</div>`);

    return `<div class="arcli-steps">\n\n${body}\n\n</div>\n`;
  });
}

/** La familia ("Monotributo · C") del comentario de la pagina, para el chip arriba del titulo. */
function voucherMeta(text) {
  const meta = text.match(/<!-- arcli: familia="([^"]+)"[^>]*-->\n*/);

  return meta ? { body: text.replace(meta[0], ''), familia: meta[1] } : { body: text, familia: null };
}

/**
 * `<!-- arcli: muestra=error|vista -->` y un bloque de texto: un cartel chico, como el que se ve en la terminal. La
 * primera linea es el titulo; en las demas, dos o mas espacios separan etiqueta y valor.
 */
function samples(text) {
  return text.replace(/<!-- arcli: muestra=(error|vista) -->\n+```text\n([\s\S]*?)\n```\n?/g, (_, kind, block) => {
    const [title, ...lines] = block.split('\n');
    const row = (line) => {
      const [label, value] = line.split(/\s{2,}/);

      return value
        ? `<span class="row"><span>${inlineHtml(label)}</span><i>${inlineHtml(value)}</i></span>`
        : `<span>${inlineHtml(line)}</span>`;
    };

    return `<div class="arcli-block"><div class="arcli-sample arcli-sample-${kind}"><b>${inlineHtml(title)}</b>${lines.map(row).join('')}</div></div>\n`;
  });
}

/**
 * `<!-- arcli: formas -->` y una tabla "Si querés | Escribís | Forma": filas que llevan a cada forma de uso, como en
 * la portada. Va despues de reescribir los links, asi el link de la tercera columna ya apunta al sitio.
 */
function ways(text) {
  return text.replace(/<!-- arcli: formas -->\n+((?:\|.*\n?)+)/g, (_, table) => {
    const rows = table
      .trim()
      .split('\n')
      .slice(2)
      .map(tableCells)
      .map(([wish, write, way]) => {
        const link = way.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        const said = write.startsWith('"');
        const what = said ? `<q>${inlineHtml(write.replace(/^"|"$/g, ''))}</q>` : inlineHtml(write);

        return `<a class="arcli-way" href="${link?.[2] ?? '#'}"><span class="q">${inlineHtml(wish)}</span><span class="do"><small>${said ? 'Le pedís' : 'Escribís'}</small>${what}</span><span class="go">${inlineHtml(link?.[1] ?? way)} →</span></a>`;
      });

    return `<div class="arcli-ways">${rows.join('')}</div>\n`;
  });
}

/** El ancla de GitHub (y de Astro) de un titulo. */
const headingSlug = (heading) =>
  heading
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');

/**
 * La severidad es `nivel` o `nivel, aclaración`: el nivel (crítico, frecuente, a veces u ocasional) va en el chip y la
 * aclaración debajo del título.
 */
const SEVERITY_KINDS = { 'a veces': 'media', crítico: 'alta', frecuente: 'frecuente', ocasional: 'baja' };

function severityParts(text, name) {
  const [, raw, note] = text.match(/^([^,]+)(?:,\s*(.+))?$/);
  const level = raw.trim();

  if (!SEVERITY_KINDS[level]) {
    throw new Error(
      `Problemas frecuentes, "${name}": la severidad "${level}" no es crítico, frecuente, a veces ni ocasional (formato: \`nivel, aclaración\`).`,
    );
  }

  return { kind: SEVERITY_KINDS[level], level, note: note && note.charAt(0).toUpperCase() + note.slice(1) };
}

/** Mensajes de otros programas (npm, PowerShell, Windows, Node) que pueden aparecer citados en un síntoma. */
const FOREIGN_OUTPUT = /^(npm|command not found|'arcli'|arcli\.ps1|dh key|ERR_|coe\.)/i;

/**
 * Las salidas de ARCLI citadas en un síntoma: lo que va entre backticks o comillas, empieza con mayúscula (o con "…")
 * y es una frase. Lo que viene de otro programa queda en el texto.
 */
function arcliMessages(text) {
  // `markdownTouches` ya puso ARCLI en negrita: adentro de un mensaje no va.
  const quoted = [...text.matchAll(/`([^`]+)`|"([^"]+)"/g)].map((match) =>
    (match[1] ?? match[2]).replace(/\*\*/g, '').trim(),
  );

  return quoted.filter(
    (message) => /^[A-ZÁÉÍÓÚÑ.…"]/.test(message) && /\s/.test(message) && !FOREIGN_OUTPUT.test(message),
  );
}

/**
 * El cuerpo de un problema en dos columnas: cada `- **Síntoma:**`, `**Causa:**`, `**Solución:**`… es una fila con la
 * etiqueta a la izquierda; lo que sigue a la viñeta (código, sublistas) va en la misma fila. Si el síntoma cita una
 * salida de ARCLI, se muestra como en la terminal; si el síntoma es solo ese mensaje, sin repetirlo en el texto.
 */
/** El texto del síntoma nombra el mensaje que ya muestra el bloque de abajo, en vez de repetirlo. */
function pointToOutput(text, messages) {
  const marked = text.replace(/`([^`]+)`|"([^"]+)"/g, (quote, code, plain) =>
    messages.includes((code ?? plain).replace(/\*\*/g, '').trim()) ? '\u0001' : quote,
  );

  const grouped = marked
    .replace(/\s*\(\u0001\)/g, '')
    .replace(/(?:un )?mensaje como \u0001/g, '\u0001')
    .replace(/\u0001(?:\s*(?:,|o|y)\s*\u0001)+/g, 'los mensajes de abajo');
  // Si nombra dos mensajes por separado, cada uno es una línea del bloque.
  const separate = grouped.split('\u0001').length - 1;
  const ordinals = ['primera', 'segunda', 'tercera'];
  let index = 0;
  const pointed = grouped
    .replace(/(?:el )?aviso \u0001|\u0001/g, (match) => {
      const line = separate > 1 ? `la ${ordinals[index++] ?? 'otra'} línea de abajo` : null;

      if (match.startsWith('el aviso') || match.startsWith('aviso'))
        return line ? `el aviso de ${line}` : 'el aviso de abajo';
      return line ?? 'el mensaje de abajo';
    })
    .replace(/^el /, 'El ');

  return /[.:)!?]$/.test(pointed) ? pointed : `${pointed}.`;
}

function faqRows(body) {
  const lines = body.split('\n');
  const rows = [];
  let more = null;

  for (const line of lines) {
    const label = line.match(/^- \*\*([^*]+?):\*\*\s*(.*)$/);

    if (label && label[1] === 'Documentación relacionada') more = label[2];
    else if (label) rows.push({ content: [label[2]], label: label[1] });
    else if (rows.length > 0 && !more) rows.at(-1).content.push(line);
    else if (!more) return null;
  }

  if (rows.length === 0) return null;

  const html = rows.map(({ content, label }) => {
    let text = content.join('\n').trim();
    let output = '';

    if (label === 'Síntoma') {
      const messages = arcliMessages(text);
      const rest = text
        .replace(/`[^`]+`|"[^"]+"/g, (quote) =>
          messages.includes(quote.slice(1, -1).replace(/\*\*/g, '').trim()) ? '' : quote,
        )
        .replace(/\b(o|y|error|arca|mensaje|como|con|un|el|aviso|al emitir|al facturar)\b/gi, '')
        .replace(/[\s.,;:()…-]/g, '');

      if (messages.length > 0) {
        output = `<pre class="arcli-salida">${messages.map((message) => escapeHtml(message)).join('\n')}</pre>`;
        text = rest === '' ? '' : pointToOutput(text, messages);
      }
    }

    // Sin la etiqueta en negrita, la oración arranca en mayúscula.
    text = text.replace(/^[a-záéíóúñ]/, (letter) => letter.toUpperCase());

    return `<div class="arcli-faq-row"><b>${label}</b><div>\n\n${text}\n\n${output}\n\n</div></div>`;
  });

  return `${html.join('\n')}\n${more ? `\n<div class="arcli-faq-more">\n\nMás en ${more}\n\n</div>\n` : ''}`;
}

/**
 * Problemas frecuentes: cada `### problema` pasa a un desplegable con su severidad al lado, agrupados por tema (`##`),
 * con un buscador arriba (`public/arcli.js`). El desplegable conserva el ancla del titulo, asi los links siguen andando.
 */
function problems(text, page) {
  if (page.src !== 'docs/troubleshooting.md') return text;

  const [head, ...parts] = text.split(/^(?=## )/m);
  const sections = parts.map((part) => {
    const [title, ...items] = part.split(/^(?=### )/m);
    const faqs = items.map((item) => {
      const [line, ...rest] = item.split('\n');
      const name = line.replace(/^### /, '');
      const severity = rest.join('\n').match(/^- \*\*Severidad:\*\* (.+)$/m);
      const body = rest
        .join('\n')
        .replace(/^- \*\*Severidad:\*\* .+\n/m, '')
        .trim();
      const rows = faqRows(body);
      const level = severity && severityParts(severity[1], name);

      return `<details class="arcli-faq" id="${headingSlug(name.replace(/`/g, ''))}">\n<summary><span class="t">${inlineHtml(name)}${level?.note ? `<span class="sub">${inlineHtml(level.note)}.</span>` : ''}</span>${level ? `<span class="sev sev-${level.kind}">${level.level}</span>` : ''}</summary>\n\n${rows ?? body}\n\n</details>\n`;
    });

    return `<section class="arcli-faq-section">\n\n${title.trim()}\n\n${faqs.join('\n')}\n</section>\n`;
  });
  const search =
    '<div class="arcli-faq-search"><input type="search" placeholder="Buscá lo que ves: EACCES, punto de venta, 10005…" aria-label="Buscar un problema"></div>\n<p class="arcli-faq-empty" hidden>No encontramos ese problema. Probá con otra palabra o mirá los errores de ARCA más abajo.</p>\n';

  return `${head.trim()}\n\n${search}\n${sections.join('\n')}`;
}

/**
 * Novedades: sin "Sin publicar" (es lo que todavia no salio), las ultimas tres versiones abiertas con la fecha abajo y
 * el resto en un desplegable por version.
 */
function releases(text, page) {
  if (page.src !== 'CHANGELOG.md') return text;

  const [head, ...parts] = text.split(/^(?=## )/m);
  const versions = parts.filter((part) => !/^## Sin publicar/.test(part));
  const dated = (part) => {
    const [line, ...rest] = part.split('\n');
    const match = line.match(/^## (.+?) · (.+)$/);

    return { body: rest.join('\n').trim(), date: match?.[2] ?? '', version: match?.[1] ?? line.replace(/^## /, '') };
  };
  const recent = versions.slice(0, 3).map((part) => {
    const { body, date, version } = dated(part);

    return `## ${version}\n\n<p class="arcli-date">${date}</p>\n\n${body}\n`;
  });
  const older = versions.slice(3).map((part) => {
    const { body, date, version } = dated(part);

    return `<details class="arcli-ver" id="${headingSlug(version)}">\n<summary><b>${version}</b><small>${date}</small></summary>\n\n${body.replace(/^### (.+)$/gm, '**$1**')}\n\n</details>\n`;
  });

  return [head.trim(), ...recent, older.length ? `## Versiones anteriores\n\n${older.join('\n')}` : ''].join('\n\n');
}

/**
 * En el texto corrido, "ARCLI" va en negrita (como en la maqueta); no en titulos, codigo, links ni lineas de HTML.
 * Los bloques de comandos llevan el titulo "Terminal" (expressive-code lo muestra arriba, con "Copiar").
 */
function markdownTouches(text) {
  return text
    .split(/(^ *```[\s\S]*?^ *```)/m)
    .map((part, index) => {
      if (index % 2 === 1)
        return part.replace(
          /^( *)```(bash|sh|shell|powershell)\n/,
          (_, indent, lang) => `${indent}\`\`\`${lang} title="${lang === 'powershell' ? 'PowerShell' : 'Terminal'}"\n`,
        );

      return part
        .split('\n')
        .map((line) => {
          if (/^\s*(#|<)/.test(line)) return line;

          return line
            .split(/(`[^`]*`|\[[^\]]*\]\([^)]*\))/)
            .map((piece, i) => (i % 2 === 1 ? piece : piece.replace(/(?<![\w*])ARCLI(?![\w*])/g, '**ARCLI**')))
            .join('');
        })
        .join('\n');
    })
    .join('');
}

/**
 * `<!-- arcli: pestañas=grupo -->` y despues `### Windows`, `### macOS`... hasta el proximo `##`: pestañas. La eleccion
 * se recuerda por grupo en todas las paginas (`public/arcli.js`). En GitHub se leen como subtitulos.
 */
function tabs(text) {
  return text.replace(/<!-- arcli: pestañas=([\w-]+) -->\n([\s\S]*?)(?=\n## |$)/g, (_, group, block) => {
    const panels = block
      .split(/^### /m)
      .slice(1)
      .map((chunk) => {
        const [name, ...rest] = chunk.split('\n');

        return { body: rest.join('\n').trim(), id: headingSlug(name.trim()), name: name.trim() };
      });
    const buttons = panels
      .map(
        (panel, i) =>
          `<button type="button" role="tab" aria-selected="${i === 0}" data-tab="${panel.id}">${panel.name}</button>`,
      )
      .join('');
    const bodies = panels
      .map(
        (panel, i) =>
          `<div role="tabpanel" data-panel="${panel.id}"${i === 0 ? '' : ' hidden'}>\n\n${panel.body}\n\n</div>`,
      )
      .join('\n');

    return `<div class="arcli-tabs" data-sync="${group}"><div role="tablist">${buttons}</div>\n${bodies}\n</div>\n`;
  });
}

/** `<!-- arcli: prompt-instalacion -->` y el link de la linea siguiente: el prompt del README, para copiar. */
function installPrompt(text) {
  return text.replace(/<!-- arcli: prompt-instalacion -->\n+[^\n]*\n/, () => {
    const readme = readFileSync(join(repoDir, 'README.md'), 'utf8');
    const prompt = readme
      .slice(readme.indexOf('### Instalar o actualizar con IA'))
      .match(/```text\n([\s\S]*?)\n```/)?.[1];

    return `\`\`\`text title="Prompt" frame="terminal" wrap\n${prompt}\n\`\`\`\n`;
  });
}

/** Un GIF solo en su linea pasa a una figura con marco y, abajo, su texto alternativo como leyenda. */
function gifs(text) {
  return text.replace(
    /^!\[([^\]]+)\]\(([^)\s]+\.gif)\)$/gm,
    (_, alt, src) =>
      `<figure class="arcli-gif"><img src="${src}" alt="${alt}" loading="lazy"><figcaption>${inlineHtml(alt)}</figcaption></figure>`,
  );
}

/** `<!-- arcli: atajos -->` y la tabla siguiente: la grilla de atajos por letra, con las letras centradas. */
function shortcutGrids(text) {
  return text.replace(
    /<!-- arcli: atajos -->\n+((?:\|.*\n?)+)/g,
    (_, table) => `<div class="arcli-atajos">\n\n${table.trim()}\n\n</div>\n`,
  );
}

/** Ancho y alto de un PNG o GIF de `docs/assets`, leidos del archivo; `null` si no se puede. */
function imageSize(url) {
  const file = url.startsWith(`${BASE}/assets/`) ? join(repoDir, 'docs', url.slice(BASE.length + 1)) : null;

  if (!file || !existsSync(file)) return null;

  const head = readFileSync(file).subarray(0, 32);

  if (head.toString('ascii', 1, 4) === 'PNG') return { height: head.readUInt32BE(20), width: head.readUInt32BE(16) };
  if (head.toString('ascii', 0, 3) === 'GIF') return { height: head.readUInt16LE(8), width: head.readUInt16LE(6) };

  return null;
}

/**
 * Las imagenes llevan su ancho y alto, asi el navegador les reserva el lugar antes de cargarlas y el texto no salta.
 * Mientras cargan se ve un fondo gris (arcli.css).
 */
function sizedImages(text) {
  return text
    .replace(/!\[([^\]]*)\]\(([^)\s]+\.(?:png|gif))\)/g, (match, alt, src) => {
      const size = imageSize(src);

      return size
        ? `<img src="${src}" alt="${alt}" width="${size.width}" height="${size.height}" loading="lazy" decoding="async">`
        : match;
    })
    .replace(/<img src="([^"]+\.(?:png|gif))"([^>]*)>/g, (match, src, rest) => {
      if (/\bheight=/.test(rest)) return match;
      const size = imageSize(src);
      if (!size) return match;
      const width = Number(rest.match(/\bwidth="(\d+)"/)?.[1] ?? size.width);
      const sized = /\bwidth=/.test(rest) ? rest : `${rest} width="${width}"`;

      return `<img src="${src}"${sized} height="${Math.round((width * size.height) / size.width)}">`;
    });
}

/** Lo que el sitio dibuja distinto que GitHub, en orden: tarjetas, chat, carteles, formas de uso, pasos, problemas y novedades. */
const SITE_TRANSFORMS = [
  gifs,
  sizedImages,
  shortcutGrids,
  optionCards,
  chats,
  samples,
  ways,
  steps,
  tabs,
  problems,
  releases,
];

/** Convierte cada bloque `> [!TIPO]` en `:::tipo ... :::`, fuera de los bloques de codigo. */
function githubAlertsToAsides(text) {
  const lines = text.split('\n');
  const out = [];
  let inCode = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (line.startsWith('```')) inCode = !inCode;

    const alert = !inCode && line.match(/^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/);

    if (!alert) {
      out.push(line);
      continue;
    }

    const body = [];

    while (index + 1 < lines.length && lines[index + 1].startsWith('>')) {
      body.push(lines[++index].replace(/^> ?/, ''));
    }

    // "**La forma más fácil:** texto" pasa a ser el titulo del aviso, como en la maqueta.
    const titled = body[0]?.match(/^\*\*([^*]+?)[:.]?\*\*[:.]?\s+(.*)$/);

    if (titled) {
      out.push(`:::${ALERT_KINDS[alert[1]]}[${titled[1]}]`);
      body[0] = titled[2].charAt(0).toUpperCase() + titled[2].slice(1);
    } else {
      out.push(`:::${ALERT_KINDS[alert[1]]}`);
    }

    out.push(...body);

    out.push(':::');
  }

  return out.join('\n');
}

async function sync() {
  for (const section of GENERATED_SECTIONS) {
    rmSync(join(contentDir, section), { force: true, recursive: true });
    rmSync(join(siteDir, 'public', section), { force: true, recursive: true });
  }

  const readme = readFileSync(join(repoDir, 'README.md'), 'utf8');
  const includedReadmeAnchors = readmeAnchors(
    readme.slice(readme.indexOf(README_FIRST_SECTION), readme.indexOf(README_END_SECTION)),
  );

  const fullText = [];

  for (const page of PAGES) {
    const { body, title } = extractBody(page, readFileSync(join(repoDir, page.src), 'utf8'));
    const target = join(contentDir, `${page.slug}.md`);

    mkdirSync(dirname(target), { recursive: true });
    const shown = page.src === 'CHANGELOG.md' ? argentineVersionDates(body) : body;
    const { body: withoutMeta, familia } = voucherMeta(shown.replace(/^<!-- Generado[^\n]*\n+/, ''));
    const content = SITE_TRANSFORMS.reduce(
      (text, transform) => transform(text, page),
      rewriteLinks(page.src, githubAlertsToAsides(markdownTouches(installPrompt(withoutMeta))), includedReadmeAnchors),
    );

    writeFileSync(target, `${frontmatter(page, title, familia ? { familia } : {})}\n${content}\n`);
    fullText.push(`# ${title}\n\nFuente: ${REPO}/blob/main/${page.src}\n\n${body}\n`);
    // Cada pagina tambien en Markdown, para asistentes de IA.
    writePublic(`${page.slug}.md`, `# ${title}\n\n${body}\n`);
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

  writeBrand(await githubStars());
  writeSidebar();

  // Para asistentes de IA: llms.txt (el resumen curado) y llms-full.txt (todo junto), en la raiz del sitio.
  writePublic('llms.txt', readFileSync(join(repoDir, 'llms.txt'), 'utf8'));
  writePublic(
    'llms-full.txt',
    `# arcli: documentación completa\n\nTodas las páginas de https://arcli.com.ar/ en un solo archivo. El resumen para agentes está en https://arcli.com.ar/llms.txt.\n\n${fullText.join('\n---\n\n')}`,
  );

  console.log(`Sitio: ${PAGES.length} páginas generadas desde docs/.`);
}

await sync();
