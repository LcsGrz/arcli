import { afterEach, describe, expect, it, vi } from 'vitest';

import { inverseColumns, legendLines, listingPanels, offCenter } from '../../../testing/terminal-layout';
import { renderStorybookShowcase } from '../showcase';

// Lo que no es ASCII ni una letra del español: ARCLI_ASCII cambia bordes y simbolos, no el idioma.
// eslint-disable-next-line no-control-regex
const NOT_ALLOWED = /[^\u0000-\u007F¿¡áéíóúüñÁÉÍÓÚÜÑ]/g;

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

describe('storybook.showcase', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('leaves no unicode symbols with ARCLI_ASCII=1', () => {
    vi.stubEnv('ARCLI_ASCII', '1');

    expect(renderStorybookShowcase().match(NOT_ALLOWED)).toBeNull();
  });

  it('shows the version under the logo, like the help', () => {
    expect(stripAnsi(renderStorybookShowcase(undefined, '2.3.0'))).toContain('v2.3.0 | LcsGrz');
  });

  it('renders all scenes in the default showcase', () => {
    const output = renderStorybookShowcase();

    expect(output).toContain('COMPROBANTES');
    expect(output).toContain('COLORES UI');
    expect(output).toContain('CONFIGURACIÓN');
    expect(output).toContain('ERRORES');
    expect(output).toContain('COMPONENTES');
    expect(output).toContain('JSON');
  });

  it('renders the queries scene', () => {
    const output = renderStorybookShowcase('consultas');

    expect(output).toContain('CONSULTAS');
    expect(output).toContain('Empresa de Ejemplo SRL');
    expect(output).toContain('00003-00001234');
  });

  it('shows the monotributo table with the own category explained once per table, below it', () => {
    const output = stripAnsi(renderStorybookShowcase('consultas'));
    const lines = output.split('\n');

    // Dos resumenes: el de 92 columnas y el de 40, con la K.
    expect(lines.filter((line) => line.includes('tu categoría')).map((line) => line.trim())).toEqual([
      '❯ tu categoría',
      '❯ tu categoría',
    ]);
  });

  it('la escena de 40 columnas mide 40 de punta a punta: panel, fondo de la K y leyenda', () => {
    vi.stubEnv('FORCE_COLOR', '1');

    const panel = listingPanels(renderStorybookShowcase('consultas')).find((item) =>
      item.inside.some((line) => /❯ K/.test(stripAnsi(line))),
    );
    const own = inverseColumns(panel?.inside.find((line) => /❯ K/.test(stripAnsi(line))) ?? '');

    expect(panel?.width).toBe(40);
    // Contenido: de la columna 3 a la 36 (40 menos bordes y margen).
    expect(own[0]).toBe(3);
    expect(own.at(-1)).toBe(36);

    // La leyenda, hasta la ficha que sigue (`┌ CATEGORÍA E`), centrada en 40.
    const after = legendLines(panel ?? { after: [], inside: [], width: 0 }).map(stripAnsi);
    const legend = after
      .slice(
        0,
        after.findIndex((line) => line.startsWith('┌')),
      )
      .filter((line) => line.trim());

    expect(legend.map((line) => line.trim())).toContain('❯ tu categoría');

    for (const line of legend) {
      expect(offCenter(line, 40)).toBeLessThanOrEqual(0.5);
    }
  });

  it('renders the certificates scene', () => {
    expect(renderStorybookShowcase('certificados')).toContain('CERTIFICADOS');
  });

  it('renders a focused billing scene', () => {
    const output = renderStorybookShowcase('comprobantes');

    expect(output).toContain('COMPROBANTES');
    expect(output).toContain('FACTURA C');
    expect(output).toContain('RESPUESTA BRUTA');
  });

  it('renders a focused json scene', () => {
    const output = stripAnsi(renderStorybookShowcase('json'));

    expect(output).toContain('JSON');
    expect(output).toContain('BILLING JSON');
    expect(output).toContain('"atajo": "fc"');
  });

  it('renders the certificate banners in the components scene', () => {
    const output = stripAnsi(renderStorybookShowcase('componentes'));

    expect(output).toContain('El certificado de producción vence el 20/11/2026 (en 10 días).');
    expect(output).toContain('El certificado de producción venció el 20/11/2026.');
    expect(output).toContain('Renovalo: https://arcli.com.ar/empezar/certificado-testing/');
  });

  it('renders a focused colors scene', () => {
    const output = stripAnsi(renderStorybookShowcase('colores'));

    expect(output).toContain('COLORES UI');
    expect(output).toContain('[OK] Paneles base listos');
    expect(output).toContain('[DEBUG] Storybook y debug visual');
  });
});
