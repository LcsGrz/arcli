import { posix } from 'node:path';

import { BASE, REPO } from '../lib/paths.mjs';
import { README_TO_INSTALL } from '../lib/readme.mjs';

/** Anclas de GitHub y de Astro: las dos usan github-slugger, asi que alcanza con conservarlas. */
function pageUrl(page, anchor) {
  return `${BASE}/${page.slug}/${anchor ? `#${anchor}` : ''}`;
}

/**
 * A donde apunta un link relativo de `src`: pagina del sitio, archivo en GitHub o lo deja igual. `bySource` es el mapa
 * de archivo de `docs/` a pagina, y `aliases`, el de los indices que quedaron en `docs/` a la pagina con el contenido.
 */
export function rewriteTarget(src, target, { aliases, bySource }) {
  if (/^(https?:|mailto:|#)/.test(target)) {
    const github = target.match(/^https:\/\/github\.com\/LcsGrz\/arcli\/blob\/main\/([^#?]+)(?:#(.*))?$/);

    return github
      ? rewriteTarget('', github[1], { aliases, bySource }).replace(/#$/, '') + (github[2] ? `#${github[2]}` : '')
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
      : (aliases[resolved] ?? resolved);
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
export function rewriteLinks(text, { aliases, bySource, page }) {
  const parts = text.split(/(^```[\s\S]*?^```)/m);
  const rewrite = (_, open, target, close) => open + rewriteTarget(page.src, target, { aliases, bySource }) + close;

  return parts
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(/(!?\[[^\]]*\]\()([^)\s]+)(\))/g, rewrite).replace(/(<img\s[^>]*src=")([^"]+)(")/g, rewrite),
    )
    .join('');
}
