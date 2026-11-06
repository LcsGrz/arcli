import { describe, expect, it } from 'vitest';

import { formatFceObligationAsText } from '../fce-obligation.presenter';

function text(minimumAmount: number): string {
  return formatFceObligationAsText({
    cuit: 20123456786,
    environment: 'testing',
    issueDate: '20261101',
    obligation: { minimumAmount, obligated: true },
  });
}

describe('formatFceObligationAsText', () => {
  it('muestra el monto mínimo con el formato de los importes', () => {
    expect(text(3958316)).toContain('$ 3.958.316');
    expect(text(3958316)).not.toContain(',00');
    expect(text(3958316.5)).toContain('$ 3.958.316,50');
  });
});
