import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ICONS } from '../../site/src/icons';

import {
  applyHeadings,
  DEFAULT_REF,
  ICON_COLOR,
  ICONS_DIR,
  README_HEADINGS,
  readmeRef,
  renderIcons,
  renderSvg,
} from './readme-iconos';

/**
 * Los íconos del README son los dibujos de `site/src/icons.ts`. Si falla: `yarn docs:readme-iconos` (o con
 * `--ref <rama>` mientras el PR apunta a su rama).
 */
const root = new URL('../../', import.meta.url);
const readme = readFileSync(new URL('README.md', root), 'utf8');

describe('íconos del README', () => {
  it('docs/assets/iconos tiene los SVG de icons.ts, ni más ni menos', () => {
    const dir = new URL(`${ICONS_DIR}/`, root);
    const expected = renderIcons();
    const actual = new Map(
      readdirSync(dir)
        .filter((file) => file.endsWith('.svg'))
        .map((file) => [file, readFileSync(new URL(file, dir), 'utf8')]),
    );

    expect(actual).toEqual(expected);
  });

  it('cada SVG es el trazo de icons.ts en celeste', () => {
    const svg = renderSvg('terminal');

    expect(svg).toContain(ICONS.terminal);
    expect(svg).toContain(`stroke="${ICON_COLOR}"`);
    expect(svg).not.toContain('style=');
  });

  it('cada título ## del README tiene su ícono y su ancla de siempre', () => {
    const ref = readmeRef(readme);

    expect(ref).toBeDefined();
    expect(readme).toBe(applyHeadings(readme, ref));
    for (const { anchor } of README_HEADINGS) expect(readme).toContain(`<a id="${anchor}"></a>`);
  });

  it('applyHeadings pone el ícono, el ancla y la rama', () => {
    const output = applyHeadings('Intro.\n\n## Empezar\n\nTexto.\n');

    expect(output).toBe(
      `Intro.\n\n<a id="empezar"></a>\n\n## <img src="https://raw.githubusercontent.com/LcsGrz/arcli/${DEFAULT_REF}/docs/assets/iconos/terminal.svg" width="24" height="24" alt="" align="absmiddle"> Empezar\n\nTexto.\n`,
    );
    expect(applyHeadings(output, 'docs/x')).toContain('/arcli/docs/x/docs/assets/iconos/terminal.svg');
    expect(readmeRef(applyHeadings(output, 'docs/x'))).toBe('docs/x');
    expect(applyHeadings(applyHeadings(output, 'docs/x'))).toBe(output);
  });

  it('applyHeadings falla con un título sin ícono', () => {
    expect(() => applyHeadings('## Otro título\n')).toThrow('README_HEADINGS');
  });
});
