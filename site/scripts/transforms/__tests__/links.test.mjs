import { describe, expect, it } from 'vitest';

import { rewriteLinks, rewriteTarget } from '../links.mjs';

const pages = [
  { slug: 'empezar/instalar', src: 'docs/instalar.md' },
  { slug: 'empezar/certificado-testing', src: 'docs/certificado-testing.md' },
  { slug: 'empezar/certificado-produccion-completo', src: 'docs/certificado-produccion-completa.md' },
  { slug: 'comprobantes/factura-c', src: 'docs/comprobantes/factura-c.md' },
];
const links = {
  aliases: { 'docs/obtencion-certificados.md': 'docs/certificado-testing.md' },
  bySource: new Map(pages.map((page) => [page.src, page])),
};
const target = (src, link) => rewriteTarget(src, link, links);
const GITHUB = 'https://github.com/LcsGrz/arcli/blob/main';

describe('rewriteTarget', () => {
  it('un doc del sitio va a su pagina, con el ancla', () => {
    expect(target('docs/glossary.md', 'instalar.md#configurar')).toBe('/empezar/instalar/#configurar');
    expect(target('docs/comprobantes/README.md', 'factura-c.md')).toBe('/comprobantes/factura-c/');
  });

  it('docs/README.md va a la portada', () => {
    expect(target('docs/instalar.md', 'README.md')).toBe('/');
  });

  it('del README, lo de instalar va a "Instalar y configurar" y el resto a GitHub', () => {
    expect(target('docs/glossary.md', '../README.md#instalación')).toBe('/empezar/instalar/#instalar-a-mano');
    expect(target('docs/glossary.md', '../README.md')).toBe('/empezar/instalar/');
    expect(target('docs/glossary.md', '../README.md#licencia')).toBe(`${GITHUB}/README.md#licencia`);
  });

  it('un indice de docs/ va a la pagina con el contenido; el punto de venta, a la guia de produccion', () => {
    expect(target('docs/glossary.md', 'obtencion-certificados.md#paso-1')).toBe('/empezar/certificado-testing/#paso-1');
    expect(target('docs/glossary.md', 'obtencion-certificados.md#punto-de-venta-para-web-service')).toBe(
      '/empezar/certificado-produccion-completo/#punto-de-venta-para-web-service',
    );
  });

  it('las imagenes van a /assets y lo que no esta en el sitio, a GitHub', () => {
    expect(target('docs/instalar.md', 'assets/demo/x.gif')).toBe('/assets/demo/x.gif');
    expect(target('docs/glossary.md', 'architecture.md#capas')).toBe(`${GITHUB}/docs/architecture.md#capas`);
  });

  it('un link absoluto a un doc en GitHub pasa al sitio; el resto de los externos queda igual', () => {
    expect(target('docs/glossary.md', `${GITHUB}/docs/instalar.md#configurar`)).toBe('/empezar/instalar/#configurar');
    expect(target('docs/glossary.md', `${GITHUB}/docs/instalar.md`)).toBe('/empezar/instalar/');
    expect(target('docs/glossary.md', 'https://arca.gob.ar')).toBe('https://arca.gob.ar');
    expect(target('docs/glossary.md', '#ancla')).toBe('#ancla');
  });
});

describe('rewriteLinks', () => {
  const page = { src: 'docs/glossary.md' };

  it('reescribe links, imagenes e <img>, pero no adentro de un bloque de codigo', () => {
    const input = [
      'Ver [instalar](instalar.md) y ![demo](assets/demo/a.gif).',
      '<img src="assets/imagenes/b.png" width="300">',
      '```md',
      '[instalar](instalar.md)',
      '```',
    ].join('\n');

    expect(rewriteLinks(input, { ...links, page })).toBe(
      [
        'Ver [instalar](/empezar/instalar/) y ![demo](/assets/demo/a.gif).',
        '<img src="/assets/imagenes/b.png" width="300">',
        '```md',
        '[instalar](instalar.md)',
        '```',
      ].join('\n'),
    );
  });
});
