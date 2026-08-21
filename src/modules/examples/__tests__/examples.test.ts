import { describe, expect, it } from 'vitest';

import { stripAnsi } from '../../../ui';
import { renderExamples } from '../examples';

describe('examples', () => {
  it('includes minima and full examples in long and short forms', () => {
    const output = stripAnsi(renderExamples());

    expect(output).toContain('[MINIMA LARGA]');
    expect(output).toContain('[MINIMA CORTA]');
    expect(output).toContain('[FULL LARGA]');
    expect(output).toContain('[FULL CORTA]');
    expect(output).toContain('arcli factura c --monto 300000');
    expect(output).toContain('arcli fc -m 300000 --cs --cfinal --ir-cf --previsualizar');
  });
});
