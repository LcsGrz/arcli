import { afterEach, describe, expect, it } from 'vitest';

import { colorize, shouldUseColor, stripAnsi, wrapIndentedPlainText } from '../text';

describe('wrapIndentedPlainText', () => {
  it('deja igual las lineas que entran', () => {
    expect(wrapIndentedPlainText('  Moneda   ARS', 40)).toEqual(['  Moneda   ARS']);
  });

  it('en filas etiqueta/valor parte el valor debajo de su columna', () => {
    expect(wrapIndentedPlainText('  Moneda                 Pesos argentinos (ARS)', 40)).toEqual([
      '  Moneda                 Pesos',
      '                         argentinos',
      '                         (ARS)',
    ]);
  });

  it('si no queda lugar para la columna del valor, apila etiqueta y valor', () => {
    expect(wrapIndentedPlainText('  Una etiqueta muy larga      valor largo de verdad', 30)).toEqual([
      '  Una etiqueta muy larga',
      '    valor largo de verdad',
    ]);
  });

  it('al apilar conserva el cierre ANSI de la etiqueta', () => {
    const [label] = wrapIndentedPlainText('\u001B[1mTipo de documento        \u001B[22m  Consumidor final', 30);

    expect(label).toBe('\u001B[1mTipo de documento\u001B[22m');
  });

  it('parte texto comun respetando la sangria y corta palabras que no entran', () => {
    expect(wrapIndentedPlainText('  uno dos tres cuatro', 12)).toEqual(['  uno dos', '  tres', '  cuatro']);
    expect(wrapIndentedPlainText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('mantiene la columna del valor aunque la etiqueta venga en negrita', () => {
    const line = '\u001B[1mMoneda                 \u001B[22m  Pesos argentinos (ARS)';
    const wrapped = wrapIndentedPlainText(line, 40).map(stripAnsi);

    expect(wrapped).toEqual([
      'Moneda                   Pesos',
      '                         argentinos',
      '                         (ARS)',
    ]);
  });
});

function withColors(run: () => void): void {
  const isTty = process.stdout.isTTY;
  const noColor = process.env.NO_COLOR;
  const forceColor = process.env.FORCE_COLOR;

  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;

  try {
    run();
  } finally {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: isTty });

    if (noColor !== undefined) {
      process.env.NO_COLOR = noColor;
    }

    if (forceColor !== undefined) {
      process.env.FORCE_COLOR = forceColor;
    }
  }
}

describe('colorize', () => {
  it('cierra el atenuado (muted) para que no apague lo que sigue', () => {
    withColors(() => {
      expect(colorize('Esto equivale a:', 'muted')).toBe('\u001B[2mEsto equivale a:\u001B[22m');
      expect(colorize('arcli fc', 'info')).toBe('\u001B[36marcli fc\u001B[39m');
    });
  });
});

describe('shouldUseColor', () => {
  const saved = { force: process.env.FORCE_COLOR, isTty: process.stdout.isTTY, noColor: process.env.NO_COLOR };

  function setEnv(
    isTty: boolean | undefined,
    env: { readonly FORCE_COLOR?: string; readonly NO_COLOR?: string },
  ): void {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: isTty });
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    Object.assign(process.env, env);
  }

  afterEach(() => {
    setEnv(saved.isTty, {});

    if (saved.force !== undefined) process.env.FORCE_COLOR = saved.force;
    if (saved.noColor !== undefined) process.env.NO_COLOR = saved.noColor;
  });

  it('colorea solo en una terminal real', () => {
    setEnv(true, {});
    expect(shouldUseColor()).toBe(true);

    // Con la salida en un pipe (`| jq`) isTTY es undefined: no tiene que colorear.
    setEnv(undefined, {});
    expect(shouldUseColor()).toBe(false);
  });

  it('respeta FORCE_COLOR y NO_COLOR, con NO_COLOR como prioridad', () => {
    setEnv(undefined, { FORCE_COLOR: '1' });
    expect(shouldUseColor()).toBe(true);

    setEnv(true, { FORCE_COLOR: '0' });
    expect(shouldUseColor()).toBe(false);

    setEnv(true, { FORCE_COLOR: '1', NO_COLOR: '1' });
    expect(shouldUseColor()).toBe(false);
  });
});
