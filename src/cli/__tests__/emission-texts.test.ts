import { describe, expect, it } from 'vitest';

import { formatEmissionQuestion } from '../emission-texts';

describe('formatEmissionQuestion', () => {
  it('dice en que entorno se emite', () => {
    expect(formatEmissionQuestion('la factura B', 'produccion')).toBe('¿Emitimos la factura B en PRODUCCIÓN?');
    expect(formatEmissionQuestion('el recibo C', 'testing')).toBe('¿Emitimos el recibo C en testing?');
  });
});
