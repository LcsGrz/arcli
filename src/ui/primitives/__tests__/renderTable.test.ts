import { describe, expect, it } from 'vitest';

import { renderTable } from '../renderTable';

describe('renderTable', () => {
  it('renders key value rows with aligned labels', () => {
    const output = renderTable([
      ['CUIT', '20-40950976-3'],
      ['Punto de venta', '3'],
    ]);

    expect(output).toContain('CUIT');
    expect(output).toContain('Punto de venta');
    expect(output).toContain('20-40950976-3');
    expect(output).toContain('3');
  });
});
