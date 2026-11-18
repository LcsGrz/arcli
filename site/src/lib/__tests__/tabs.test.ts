import { describe, expect, it } from 'vitest';

import { tabForKey } from '../tabs';

describe('tabForKey', () => {
  it('las flechas pasan a la de al lado y dan la vuelta', () => {
    expect(tabForKey('ArrowRight', 0, 3)).toBe(1);
    expect(tabForKey('ArrowRight', 2, 3)).toBe(0);
    expect(tabForKey('ArrowLeft', 0, 3)).toBe(2);
  });

  it('Inicio y Fin van a la primera y a la última; otra tecla no mueve', () => {
    expect(tabForKey('Home', 2, 3)).toBe(0);
    expect(tabForKey('End', 0, 3)).toBe(2);
    expect(tabForKey('Enter', 1, 3)).toBeNull();
  });
});
