import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CERTIFICATE_GUIDE_URL,
  CHANGELOG_PAGE_URL,
  DOCS_SITE_URL,
  POINT_OF_SALE_GUIDE_URL,
  TROUBLESHOOTING_URL,
} from '../links';

/** De que archivo sale cada pagina del sitio (`PAGES` de site/scripts/sync-docs.mjs). */
const PAGE_SOURCES: Record<string, string> = {
  '/ayuda/novedades/': 'CHANGELOG.md',
  '/ayuda/problemas-frecuentes/': 'docs/troubleshooting.md',
  '/empezar/certificado-produccion-completo/': 'docs/certificado-produccion-completa.md',
  '/empezar/certificado-testing/': 'docs/certificado-testing.md',
};

/** Slug de un titulo como lo arman GitHub y Starlight: minusculas, sin puntuacion, espacios a guiones. */
function headingSlugs(markdown: string): Set<string> {
  return new Set(
    [...markdown.matchAll(/^#{2,4} (.+)$/gm)].map(([, title]) =>
      title
        .toLowerCase()
        .replace(/[^\p{L}\p{N} -]/gu, '')
        .replace(/ /g, '-'),
    ),
  );
}

describe('links del CLI al sitio', () => {
  it.each([
    ['certificado', CERTIFICATE_GUIDE_URL],
    ['qué servicios autorizar', `${CERTIFICATE_GUIDE_URL}#qué-servicios-autorizar`],
    ['punto de venta', POINT_OF_SALE_GUIDE_URL],
    ['problemas frecuentes', TROUBLESHOOTING_URL],
    ['novedades', CHANGELOG_PAGE_URL],
  ])('%s apunta a una página del sitio y a un título que existe', (_name, url) => {
    expect(url.startsWith(`${DOCS_SITE_URL}/`)).toBe(true);

    const [path, anchor] = url.slice(DOCS_SITE_URL.length).split('#');
    const source = PAGE_SOURCES[path];

    expect(source, `${path} no está en PAGE_SOURCES`).toBeDefined();

    if (anchor) {
      expect(headingSlugs(readFileSync(join(process.cwd(), source), 'utf8'))).toContain(anchor);
    }
  });
});
