import { afterEach, describe, expect, it, vi } from 'vitest';

import { stripAnsi, visibleWidth } from '../../primitives/text';
import { renderRowActionsList, type RowActionsListRow } from '../rowActionsList';

const ROWS: RowActionsListRow[] = [
  { detail: '1.000 litros x 1,50 USD', title: 'Jugo de naranja concentrado', total: '1.500 USD' },
  { detail: '1 unidades x 500 USD', mark: 'remove', title: 'Flete', total: '500 USD' },
  { detail: '1 unidades x 100 USD', mark: 'edit', title: 'Seguro', total: '100 USD' },
];

function render(overrides: Partial<Parameters<typeof renderRowActionsList>[0]> = {}): string[] {
  return renderRowActionsList({
    active: 0,
    addLabel: '+ Agregar ítem',
    backLabel: '← Volver',
    highlight: (text) => `<${text}>`,
    pageSize: 12,
    rows: ROWS,
    width: 140,
    ...overrides,
  });
}

describe('renderRowActionsList (NAV-10)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('en 140 columnas, cada fila con su marca, el detalle alineado y el total; "Volver" fijo debajo', () => {
    vi.stubEnv('NO_COLOR', '1');

    const lines = render();

    expect(lines.slice(0, 7)).toEqual([
      '<❯ ◯ Jugo de naranja concentrado  1.000 litros x 1,50 USD = 1.500 USD>',
      '  ● Flete                        1 unidades x 500 USD = 500 USD',
      '  ◉ Seguro                       1 unidades x 100 USD = 100 USD',
      ' ',
      '  + Agregar ítem',
      ' ',
      '  ← Volver',
    ]);
    // El detalle de la fila del cursor y lo que va a aplicar Enter, sin depender del color.
    expect(lines).toContain('1.000 litros x 1,50 USD = 1.500 USD');
    expect(lines).toContain('1 para modificar · 1 para borrar');
  });

  it('en 40 columnas no se pasa del ancho: recorta el nombre y deja el total; el detalle entero va debajo', () => {
    vi.stubEnv('NO_COLOR', '1');

    const lines = render({ highlight: (text) => text, width: 40 });

    expect(lines.every((line) => visibleWidth(line) <= 40)).toBe(true);
    expect(lines[0]).toBe('❯ ◯ Jugo de naranja concentr…  1.500 USD');
    expect(lines[1]).toBe('  ● Flete                      500 USD');
    expect(lines).toContain('1.000 litros x 1,50 USD = 1.500 USD');
  });

  it('con ARCLI_ASCII=1, marcas y cursor en ASCII', () => {
    vi.stubEnv('NO_COLOR', '1');
    vi.stubEnv('ARCLI_ASCII', '1');

    const lines = render({ active: 3, highlight: (text) => text });

    expect(lines.slice(0, 5)).toEqual([
      '  [ ] Jugo de naranja concentrado  1.000 litros x 1,50 USD = 1.500 USD',
      '  [-] Flete                        1 unidades x 500 USD = 500 USD',
      '  [x] Seguro                       1 unidades x 100 USD = 100 USD',
      ' ',
      '> + Agregar ítem',
    ]);
    expect(lines).toContain('1 para modificar - 1 para borrar');
  });

  it('con color, el punto de borrar va en rojo y el de modificar en verde', () => {
    vi.stubEnv('FORCE_COLOR', '1');

    const [, remove, edit] = render();

    expect(remove).toContain('\u001B[');
    expect(remove).not.toBe(stripAnsi(remove ?? ''));
    expect(stripAnsi(remove ?? '')).toContain('●');
    expect(edit).not.toBe(stripAnsi(edit ?? ''));
  });

  it('si no entran, se desplaza con avisos de cuántas quedan, y muestra el aviso de la última fila', () => {
    vi.stubEnv('NO_COLOR', '1');

    const rows = Array.from({ length: 10 }, (_, index) => ({
      detail: '1 x 1',
      title: `Ítem ${index + 1}`,
      total: '1',
    }));
    const lines = render({ active: 5, notice: 'Queda al menos un ítem.', pageSize: 4, rows });

    expect(lines[0]).toBe('  ↑ 3 más');
    expect(lines.some((line) => line.includes('Ítem 6'))).toBe(true);
    expect(lines.some((line) => line.includes('Ítem 1 '))).toBe(false);
    expect(lines).toContain('  ↓ 3 más');
    expect(lines.at(-1)).toBe('Queda al menos un ítem.');
  });

  it('con el cursor en "Volver" no muestra detalle', () => {
    vi.stubEnv('NO_COLOR', '1');

    const lines = render({ active: 2, rows: [{ detail: '1 x 1', title: 'Uno', total: '1' }] });

    expect(lines).toContain('<❯ ← Volver>');
    expect(lines).not.toContain('1 x 1 = 1');
  });
});
