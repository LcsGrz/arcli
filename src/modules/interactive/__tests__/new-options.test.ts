import { describe, expect, it } from 'vitest';

import { hasNewOption, isNewOption } from '../new-options';

describe('isNewOption', () => {
  it('marca una opcion mientras arcli este a menos de dos versiones menores de la que la trajo', () => {
    // El recibo llego en la 2.3.0.
    expect(isNewOption('recibo', '2.3.0')).toBe(true);
    expect(isNewOption('recibo', '2.4.2')).toBe(true);
    expect(isNewOption('recibo', '2.5.0')).toBe(false);
  });

  it('marca lo que todavia no se publico', () => {
    expect(isNewOption('acceso-directo', '2.3.0')).toBe(true);
  });

  it('con un cambio de version mayor, lo anterior deja de ser nuevo', () => {
    expect(isNewOption('recibo', '3.0.0')).toBe(false);
  });
});

describe('hasNewOption', () => {
  it('es nuevo si alguna de las opciones lo es', () => {
    expect(hasNewOption(['autocompletado', 'certificados'], '2.4.0')).toBe(true);
    expect(hasNewOption(['autocompletado', 'certificados'], '2.5.0')).toBe(false);
  });
});
