import { describe, expect, it } from 'vitest';

import { problemsStatus } from '../docs/problems';

describe('problemsStatus', () => {
  it('sin búsqueda no dice nada; sin resultados, el texto de "no encontramos"', () => {
    expect(problemsStatus('', 30, 'No encontramos ese problema.')).toBe('');
    expect(problemsStatus('xyz', 0, 'No encontramos ese problema.')).toBe('No encontramos ese problema.');
  });

  it('cuenta los problemas que quedan, en singular o plural', () => {
    expect(problemsStatus('pv', 1, '')).toBe('1 problema encontrado.');
    expect(problemsStatus('pv', 4, '')).toBe('4 problemas encontrados.');
  });
});
