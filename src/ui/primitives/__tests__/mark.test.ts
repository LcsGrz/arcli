import { afterEach, describe, expect, it, vi } from 'vitest';

import { colorize, type UiTextColor } from '../text';

/**
 * El token `mark` (TUI-27): el fondo de la fila propia, en video inverso, para que se lea en cualquier tema de la
 * terminal. Tiene que apagarse al final de la linea: si quedara prendido, pintaria todo lo que sigue.
 */

// `mark` todavia no es un color del tema: el cast deja escribir el test antes.
const MARK = 'mark' as UiTextColor;

describe('colorize con mark', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Tests primero (TUI-27/28): pasa a it() al implementarlo.
  it.fails('prende el video inverso y lo apaga al final de cada línea', () => {
    vi.stubEnv('FORCE_COLOR', '1');

    const lines = colorize('A\nB', MARK).split('\n');

    for (const [index, line] of lines.entries()) {
      expect(line.startsWith('\u001B[7m')).toBe(true);
      expect(line.slice('\u001B[7m'.length)).toMatch(new RegExp(`^${'AB'[index]}\\u001B\\[(27|0)?m$`));
    }
  });

  it('sin color no agrega nada', () => {
    vi.stubEnv('NO_COLOR', '1');

    expect(colorize('A', MARK)).toBe('A');
  });
});
