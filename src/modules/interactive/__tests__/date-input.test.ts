import { describe, expect, it } from 'vitest';

import { completeDateInput } from '../date-input';

// 18/11/2026 al mediodia de Buenos Aires.
const TODAY = new Date('2026-11-18T15:00:00Z');

describe('completeDateInput', () => {
  it('completa el mes y el año, como el CLI con la misma fecha escrita ese día', () => {
    expect(completeDateInput('10', TODAY)).toBe('10/11/2026');
    expect(completeDateInput('1/10', TODAY)).toBe('01/10/2026');
    expect(completeDateInput('15/11/26', TODAY)).toBe('15/11/2026');
    expect(completeDateInput(' 25/12/2026 ', TODAY)).toBe('25/12/2026');
  });

  it('sin año, el de la fecha más cercana a hoy', () => {
    expect(completeDateInput('10/1', TODAY)).toBe('10/01/2027');
  });
});
