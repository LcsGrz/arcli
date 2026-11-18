import { describe, expect, it } from 'vitest';

import { argentineVersionDates } from '../dates.mjs';
import { releases } from '../releases.mjs';

describe('argentineVersionDates', () => {
  it('pasa las fechas de Keep a Changelog a dd/mm/aaaa', () => {
    expect(argentineVersionDates('## [Sin publicar]\n\n## [2.4.0] - 2026-11-08\n\n### [x] - 2026-01-01')).toBe(
      '## Sin publicar\n\n## 2.4.0 · 08/11/2026\n\n### [x] - 2026-01-01',
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
    ['⚠️ Puede afectar a quien ya lo usa', 'aviso'],
    ['Otra cosa', 'otro'],
  ])('el tipo "%s" va con el chip %s', (name, kind) => {
    expect(releases(`# C\n\n## 1.0.0 · 01/01/2026\n\n### ${name}\n`)).toContain(
      `<span class="arcli-chip arcli-kind arcli-kind-${kind}">${name}</span>`,
    );
  });

  it('con 3 versiones o menos no hay "Versiones anteriores"', () => {
    expect(releases(`# C\n\n${version(1)}`)).not.toContain('Versiones anteriores');
  });
});
