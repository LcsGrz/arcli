import { describe, expect, it } from 'vitest';

import { argentineVersionDates } from '../dates.mjs';
import { releases } from '../releases.mjs';

describe('argentineVersionDates', () => {
  it('pasa las fechas de Keep a Changelog a dd/mm/aaaa', () => {
    expect(argentineVersionDates('## [Sin publicar]\n\n## [2.4.0] - 2026-11-08\n\n### [x] - 2026-01-01')).toBe(
      '## Sin publicar\n\n## 2.4.0 · 08/11/2026\n\n### [x] - 2026-01-01',
    );
  });

  it('deja el nombre de la version al final', () => {
    expect(argentineVersionDates('## [2.6.0] - 2026-11-21 · Monotributo y recibos')).toBe(
      '## 2.6.0 · 21/11/2026 · Monotributo y recibos',
    );
  });
});

describe('releases', () => {
  const version = (n) => `## 2.${n}.0 · 0${n}/11/2026\n\n### Agregado\n\n- Algo ${n}.\n`;

  it('saca "Sin publicar", deja abiertas las ultimas 3 y pliega el resto, con chips por tipo de cambio', () => {
    const input = `# Cambios\n\nIntro.\n\n## Sin publicar\n\n- Nada.\n\n${[5, 4, 3, 2].map(version).join('\n')}`;

    expect(releases(input)).toBe(
      [
        '# Cambios\n\nIntro.',
        '## 2.5.0\n\n<p class="arcli-date">05/11/2026</p>\n\n### <span class="arcli-chip arcli-kind arcli-kind-agregado">Agregado</span>\n\n- Algo 5.\n',
        '## 2.4.0\n\n<p class="arcli-date">04/11/2026</p>\n\n### <span class="arcli-chip arcli-kind arcli-kind-agregado">Agregado</span>\n\n- Algo 4.\n',
        '## 2.3.0\n\n<p class="arcli-date">03/11/2026</p>\n\n### <span class="arcli-chip arcli-kind arcli-kind-agregado">Agregado</span>\n\n- Algo 3.\n',
        '## Versiones anteriores\n\n<details class="arcli-ver" id="220">\n<summary><b>2.2.0</b><small>02/11/2026</small></summary>\n\n<p><span class="arcli-chip arcli-kind arcli-kind-agregado">Agregado</span></p>\n\n- Algo 2.\n\n</details>\n',
      ].join('\n\n'),
    );
  });

  it.each([
    ['Corregido', 'arreglado'],
    ['Documentación', 'documentacion'],
    ['Deprecado', 'deprecado'],
    ['Otra cosa', 'otro'],
  ])('el tipo "%s" va con el chip %s', (name, kind) => {
    expect(releases(`# C\n\n## 1.0.0 · 01/01/2026\n\n### ${name}\n`)).toContain(
      `<span class="arcli-chip arcli-kind arcli-kind-${kind}">${name}</span>`,
    );
  });

  it.each([
    ['✨ Agregado', '✨', 'Agregado', 'agregado'],
    ['🐛 Corregido', '🐛', 'Corregido', 'arreglado'],
    ['⏳ Deprecado', '⏳', 'Deprecado', 'deprecado'],
    ['🔒 Seguridad', '🔒', 'Seguridad', 'seguridad'],
    ['⚠️ Puede afectar a quien ya lo usa', '⚠️', 'Puede afectar a quien ya lo usa', 'aviso'],
  ])('el icono de "%s" va en data-icon, fuera del texto (y del ancla)', (name, icon, label, kind) => {
    expect(releases(`# C\n\n## 1.0.0 · 01/01/2026\n\n### ${name}\n`)).toContain(
      `### <span class="arcli-chip arcli-kind arcli-kind-${kind}" data-icon="${icon}">${label}</span>`,
    );
  });

  it('el nombre de la version va al lado del numero, abierta y plegada', () => {
    const named = (n) => `## 2.${n}.0 · 0${n}/11/2026 · Nombre ${n}\n\n### Agregado\n\n- Algo ${n}.\n`;
    const output = releases(`# C\n\n${[5, 4, 3, 2].map(named).join('\n')}`);

    expect(output).toContain(
      '## 2.5.0 <span class="arcli-ver-name">· Nombre 5</span>\n\n<p class="arcli-date">05/11/2026</p>',
    );
    expect(output).toContain(
      '<summary><b>2.2.0</b><span class="arcli-ver-name">Nombre 2</span><small>02/11/2026</small></summary>',
    );
  });

  it('los destacados (#### con texto y codigo) van en tarjetas, hasta el aviso; el resumen y las secciones no', () => {
    const input = [
      '# C',
      '',
      '## 2.6.0 · 21/11/2026 · Monotributo y recibos',
      '',
      'Resumen.',
      '',
      '#### El monotributo',
      '',
      'Las categorías.',
      '',
      '```sh',
      'arcli monotributo',
      '---',
      '```',
      '',
      '#### Recibos',
      '',
      'Recibo A y B.',
      '',
      ':::caution[Puede afectar scripts]',
      '- Algo.',
      ':::',
      '',
      '---',
      '',
      '### ✨ Agregado',
      '',
      '- **Recibos:** algo.',
      '',
    ].join('\n');

    expect(releases(input)).toBe(
      [
        '# C',
        [
          '## 2.6.0 <span class="arcli-ver-name">· Monotributo y recibos</span>',
          '',
          '<p class="arcli-date">21/11/2026</p>',
          '',
          'Resumen.',
          '',
          '<div class="arcli-highlights">',
          '',
          '<div class="arcli-highlight">',
          '',
          '#### El monotributo',
          '',
          'Las categorías.',
          '',
          '```sh',
          'arcli monotributo',
          '---',
          '```',
          '',
          '</div>',
          '',
          '<div class="arcli-highlight">',
          '',
          '#### Recibos',
          '',
          'Recibo A y B.',
          '',
          '</div>',
          '',
          '</div>',
          '',
          ':::caution[Puede afectar scripts]',
          '- Algo.',
          ':::',
          '',
          '---',
          '',
          '### <span class="arcli-chip arcli-kind arcli-kind-agregado" data-icon="✨">Agregado</span>',
          '',
          '- **Recibos:** algo.',
          '',
        ].join('\n'),
        '',
      ].join('\n\n'),
    );
  });

  it('con 3 versiones o menos no hay "Versiones anteriores"', () => {
    expect(releases(`# C\n\n${version(1)}`)).not.toContain('Versiones anteriores');
  });
});
