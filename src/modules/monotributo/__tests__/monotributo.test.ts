import { describe, expect, it } from 'vitest';

import {
  lastMonotributoUpdateCutoff,
  nextMonotributoCategory,
  parseMonotributoLetter,
  staleTableNotice,
} from '../monotributo';
import { BUNDLED_MONOTRIBUTO_TABLE } from '../monotributo.bundled';

describe('lastMonotributoUpdateCutoff', () => {
  it.each([
    ['20260115', '20250801'],
    ['20260201', '20250801'], // el mismo 1/2 todavia no cuenta: ARCA publica durante el mes
    ['20260202', '20260201'],
    ['20260731', '20260201'],
    ['20260801', '20260201'],
    ['20260802', '20260801'],
    ['20261231', '20260801'],
  ])('hoy %s → corte %s', (today, cutoff) => {
    expect(lastMonotributoUpdateCutoff(today)).toBe(cutoff);
  });
});

describe('staleTableNotice', () => {
  it('avisa si pasó un corte y la tabla guardada rige desde antes', () => {
    expect(staleTableNotice({ source: 'guardada', today: '20270215', validFrom: '20260801' })).toBe(
      'ARCA actualiza las categorías en febrero y agosto. La tabla guardada es del 01/08/2026 y puede haber una nueva. Actualizala con `arcli monotributo --actualizar`.',
    );
  });

  it('nombra la tabla incluida', () => {
    expect(staleTableNotice({ source: 'incluida', today: '20270215', validFrom: '20260801' })).toContain(
      'La tabla incluida en ARCLI es del 01/08/2026',
    );
  });

  it('no avisa si la tabla rige desde el último corte o después', () => {
    expect(staleTableNotice({ source: 'guardada', today: '20261118', validFrom: '20260801' })).toBeUndefined();
    expect(staleTableNotice({ source: 'guardada', today: '20270201', validFrom: '20260801' })).toBeUndefined();
  });

  it('no avisa con la tabla recién leída de ARCA, aunque ARCA todavía no la haya cambiado', () => {
    expect(staleTableNotice({ source: 'arca', today: '20270215', validFrom: '20260801' })).toBeUndefined();
  });
});

describe('parseMonotributoLetter', () => {
  it.each([
    ['E', 'E'],
    ['e', 'E'],
    [' k ', 'K'],
  ])('"%s" → %s', (value, letter) => {
    expect(parseMonotributoLetter(value)).toBe(letter);
  });

  it.each(['', 'L', 'Z', 'EE', '1'])('"%s" no es una categoría', (value) => {
    expect(parseMonotributoLetter(value)).toBeUndefined();
  });
});

describe('nextMonotributoCategory', () => {
  it('la que sigue, y ninguna después de la K', () => {
    expect(nextMonotributoCategory(BUNDLED_MONOTRIBUTO_TABLE, 'E')?.letter).toBe('F');
    expect(nextMonotributoCategory(BUNDLED_MONOTRIBUTO_TABLE, 'K')).toBeUndefined();
  });
});
