import { afterEach, describe, expect, it, vi } from 'vitest';

import { colorize, markRow, type UiTextColor } from '../text';

/**
 * El token `mark` (TUI-27): el fondo de la fila propia, en video inverso, para que se lea en cualquier tema de la
 * terminal. Tiene que apagarse al final de la linea: si quedara prendido, pintaria todo lo que sigue.
 */

const MARK: UiTextColor = 'mark';

describe('colorize con mark', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prende el video inverso y lo apaga al final de cada línea', () => {
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

describe('markRow', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('con color rellena cada línea hasta el ancho, adentro del fondo', () => {
    vi.stubEnv('FORCE_COLOR', '1');

    expect(markRow('❯ E\n  x', 5).split('\n')).toEqual(['\u001B[7m❯ E  \u001B[27m', '\u001B[7m  x  \u001B[27m']);
  });

  it('sin color no pinta ni rellena', () => {
    vi.stubEnv('NO_COLOR', '1');

    expect(markRow('❯ E', 10)).toBe('❯ E');
  });
});
