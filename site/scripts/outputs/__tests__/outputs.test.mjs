import { describe, expect, it } from 'vitest';

import { extractBody } from '../../lib/body.mjs';
import { brandData } from '../brand.mjs';
import { pageDescription } from '../description.mjs';
import { frontmatter } from '../frontmatter.mjs';
import { llmsFull } from '../llms.mjs';
import { buildSidebar } from '../sidebar.mjs';

describe('extractBody', () => {
  it('saca el titulo y la linea de "Volver al README"', () => {
    expect(extractBody({ src: 'docs/a.md' }, '[← Volver](../README.md)\r\n\r\n# Título\r\n\r\nTexto.\r\n')).toEqual({
      body: 'Texto.',
      title: 'Título',
    });
  });

  it('el titulo de PAGES gana; sin # falla', () => {
    expect(extractBody({ src: 'CHANGELOG.md', title: 'Novedades' }, '# Changelog\n\nX')).toEqual({
      body: 'X',
      title: 'Novedades',
    });
    expect(() => extractBody({ src: 'docs/a.md' }, 'Sin titulo')).toThrow('docs/a.md: falta el título');
  });
});

describe('pageDescription', () => {
  it('toma las oraciones enteras del primer parrafo que entran en 160 caracteres', () => {
    const long = 'Otra oración bastante larga que ya no entra en el límite de los buscadores. '.repeat(2);

    expect(pageDescription({ src: 'a' }, 'A', `> aviso\n\nPrimera [oración](x). ${long}`)).toBe(
      'Primera oración. Otra oración bastante larga que ya no entra en el límite de los buscadores.',
    );
  });

  it('en un comprobante, antes va "Cómo emitir…"; la de PAGES gana', () => {
    expect(pageDescription({ src: 'a', voucher: true }, 'Recibo C', 'Para cobrar.')).toBe(
      'Cómo emitir un Recibo C con ARCLI. Para cobrar.',
    );
    expect(pageDescription({ description: 'La `propia`.', src: 'a' }, 'A', 'Intro.')).toBe('La propia.');
  });

  it('falla sin descripcion o si es larga', () => {
    expect(() => pageDescription({ src: 'a' }, 'A', '- lista')).toThrow('sin descripción');
    expect(() => pageDescription({ description: 'x'.repeat(161), src: 'a' }, 'A', '')).toThrow('pasa de 160');
  });
});

describe('frontmatter', () => {
  it('el orden es la posicion en la seccion; extra va al final', () => {
    const pages = [
      { slug: 'uno/a', src: 'docs/a.md' },
      { slug: 'dos/b', src: 'docs/b.md' },
      { label: 'Corto', slug: 'dos/c', src: 'docs/c.md' },
    ];

    expect(frontmatter(pages[2], pages, { description: 'D', extra: { familia: 'F' }, title: 'T "c"' })).toBe(
      [
        '---',
        'title: "T \\"c\\""',
        'description: "D"',
        'editUrl: "https://github.com/LcsGrz/arcli/edit/dev/docs/c.md"',
        'sidebar:',
        '  label: "Corto"',
        '  order: 2',
        'familia: "F"',
        '---',
        '',
      ].join('\n'),
    );
  });
});

describe('buildSidebar', () => {
  it('una seccion por carpeta, sin las ocultas ni las vacias, y los grupos plegables', () => {
    const sections = [
      { dir: 'a', label: 'A' },
      { dir: 'vacia', label: 'Vacía' },
    ];
    const pages = [
      { icon: 'i', label: 'Uno', slug: 'a/uno' },
      { hidden: true, label: 'Oculta', slug: 'a/oculta' },
      { group: 'G', icon: 'j', label: 'Dos', slug: 'a/dos' },
      { group: 'G', icon: 'k', slug: 'a/tres', title: 'Tres' },
    ];

    expect(buildSidebar(sections, pages)).toEqual([
      {
        items: [
          { attrs: { 'data-icon': 'i' }, label: 'Uno', slug: 'a/uno' },
          {
            collapsed: true,
            items: [
              { attrs: { 'data-icon': 'j' }, label: 'Dos', slug: 'a/dos' },
              { attrs: { 'data-icon': 'k' }, label: 'Tres', slug: 'a/tres' },
            ],
            label: 'G',
          },
        ],
        label: 'A',
      },
    ]);
  });
});

describe('brandData', () => {
  it('lee el logo y la columna de renderLogo.ts y la version de package.json', () => {
    const logoSource =
      "const ARCLI_BANNER_AR_CLI_SPLIT_COLUMN = 12;\nexport const ARCLI_ASCII_BANNER = [\n  ' ab  ',\n  'cd',\n].join('\\n');";

    expect(brandData({ installPrompt: 'P', logoSource, packageJson: '{"version":"1.2.3"}', stars: 7 })).toEqual({
      banner: [' ab', 'cd'],
      installPrompt: 'P',
      splitColumn: 12,
      stars: 7,
      version: '1.2.3',
    });
    expect(() => brandData({ logoSource: '', packageJson: '{}' })).toThrow('renderLogo.ts');
  });
});

describe('llmsFull', () => {
  it('une las paginas con su fuente', () => {
    const output = llmsFull([
      { body: 'Uno.', page: { src: 'docs/a.md' }, title: 'A' },
      { body: 'Dos.', page: { src: 'docs/b.md' }, title: 'B' },
    ]);

    expect(
      output.endsWith(
        '# A\n\nFuente: https://github.com/LcsGrz/arcli/blob/main/docs/a.md\n\nUno.\n\n---\n\n# B\n\nFuente: https://github.com/LcsGrz/arcli/blob/main/docs/b.md\n\nDos.\n',
      ),
    ).toBe(true);
  });
});
