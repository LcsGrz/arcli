import { describe, expect, it } from 'vitest';

import { monotributoBlockKeys } from '../monotributo-menu';

describe('monotributoBlockKeys', () => {
  const help = (keys: ReadonlyArray<readonly [string, string]>) =>
    keys.map(([key, action]) => `${key} ${action}`).join(' · ');

  it('sin ventana, ←/→ cambian de bloque', () => {
    expect(help(monotributoBlockKeys())).toBe('←→ cambiar de bloque · ⏎ volver al menú');
  });

  it('con ventana, ←/→ corren las columnas y, pasada la última, cambian de bloque', () => {
    expect(help(monotributoBlockKeys({ columns: true }))).toBe(
      '←→ mover columnas; después de la última, cambiar de bloque · ⏎ volver al menú',
    );
  });
});
