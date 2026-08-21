import { describe, expect, it } from 'vitest';

import { renderStorybookShowcase } from '../showcase';

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

describe('storybook.showcase', () => {
  it('renders all scenes in the default showcase', () => {
    const output = renderStorybookShowcase();

    expect(output).toContain('COMPROBANTES');
    expect(output).toContain('COLORES UI');
    expect(output).toContain('CONFIGURACION');
    expect(output).toContain('ERRORES');
    expect(output).toContain('COMPONENTES');
    expect(output).toContain('JSON');
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

  it('renders a focused colors scene', () => {
    const output = stripAnsi(renderStorybookShowcase('colores'));

    expect(output).toContain('COLORES UI');
    expect(output).toContain('[OK] Paneles base listos');
    expect(output).toContain('[DEBUG] Storybook y debug visual');
  });
});
