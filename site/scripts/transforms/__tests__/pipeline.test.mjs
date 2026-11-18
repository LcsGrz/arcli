import { describe, expect, it } from 'vitest';

import { transformPage } from '../index.mjs';

const page = (src) => ({ slug: 'x/y', src });
const ctx = (src) => {
  const instalar = { slug: 'empezar/instalar', src: 'docs/instalar.md' };

  return {
    aliases: {},
    bySource: new Map([[instalar.src, instalar]]),
    imageSize: () => null,
    page: page(src),
    readmePrompt: () => 'Prompt.',
  };
};

describe('transformPage', () => {
  it('saca el comentario de "Generado" y la familia, y corre los pasos en orden', () => {
    const body = [
      '<!-- Generado por `yarn docs:comprobantes`. -->',
      '<!-- arcli: familia="Monotributo · C" icono="f" orden="1" -->',
      '',
      'ARCLI emite. Ver [instalar](../instalar.md).',
      '',
      '> [!TIP]',
      '> Ojo.',
    ].join('\n');

    expect(transformPage(body, ctx('docs/comprobantes/factura-c.md'))).toEqual({
      content: '**ARCLI** emite. Ver [instalar](/empezar/instalar/).\n\n:::tip\nOjo.\n:::',
      familia: 'Monotributo · C',
      source: 'ARCLI emite. Ver [instalar](../instalar.md).\n\n> [!TIP]\n> Ojo.',
    });
  });

  it('los links se reescriben antes de "formas", asi la tabla apunta al sitio', () => {
    const body = '<!-- arcli: formas -->\n| a | b | c |\n| - | - | - |\n| A | `x` | [Instalar](instalar.md) |';

    expect(transformPage(body, ctx('docs/mental-model.md')).content).toContain('href="/empezar/instalar/"');
  });

  it('Problemas frecuentes y Novedades solo corren en su pagina', () => {
    const body = '## Sin publicar\n\n## [1.0.0] - 2026-01-02\n\n### Agregado\n';

    expect(transformPage(body, ctx('docs/glossary.md')).content).toBe(body);
    expect(transformPage(body, ctx('CHANGELOG.md')).content).toContain('<p class="arcli-date">02/01/2026</p>');
    expect(transformPage('## A\n\n### B\n', ctx('docs/troubleshooting.md')).content).toContain('arcli-faq');
  });
});
