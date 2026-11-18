import { afterEach, describe, expect, it } from 'vitest';

import {
  colorize,
  padEndVisible,
  renderForTarget,
  shouldUseColor,
  stripAnsi,
  visibleWidth,
  wrapIndentedPlainText,
  wrapPanelLines,
  wrapPlainText,
} from '../text';

// `é` armada como `e` + acento combinable (NFD), como la pega macOS desde Finder o un PDF.
const E_NFD = 'é';

describe('visibleWidth', () => {
  it('cuenta columnas de la terminal, no unidades de UTF-16', () => {
    expect(visibleWidth('Pesos')).toBe(5);
    expect(visibleWidth('🧾')).toBe(2);
    expect(visibleWidth('👩‍💻')).toBe(2);
    expect(visibleWidth('東京')).toBe(4);
    expect(visibleWidth(`Jos${E_NFD}`)).toBe(4);
  });

  it('no cuenta los colores ni los links', () => {
    expect(visibleWidth('\u001B[1m\u001B[36m🧾 Café\u001B[39m\u001B[22m')).toBe(7);
    expect(visibleWidth('\u001B]8;;file:///tmp/x\u001B\\x.pdf\u001B]8;;\u001B\\')).toBe(5);
  });

  it('padEndVisible rellena hasta el ancho visible', () => {
    expect(padEndVisible('東京', 6)).toBe('東京  ');
    expect(padEndVisible(`Jos${E_NFD}`, 6)).toBe(`Jos${E_NFD}  `);
  });
});

describe('cortes por grafema', () => {
  it('no parte un emoji ni una letra con su acento al cortar una palabra larga', () => {
    const word = `ab🧾cd👩‍💻ef${E_NFD}${E_NFD}`;
    const wrapped = wrapIndentedPlainText(word, 3);

    expect(wrapped.join('')).toBe(word);
    for (const line of wrapped) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(3);
      expect(line.isWellFormed()).toBe(true);
    }
    expect(wrapped).toEqual(['ab', '🧾c', 'd👩‍💻', `ef${E_NFD}`, E_NFD]);
  });

  it('con una sola columna, el emoji va igual en vez de trabarse', () => {
    expect(wrapPlainText('🧾🧾', 1)).toEqual(['🧾', '🧾']);
  });

  it('parte CJK por ancho visible', () => {
    expect(wrapPlainText('東京都港区', 4)).toEqual(['東京', '都港', '区']);
  });

  it('deja intacta una linea con é NFD que entra', () => {
    const line = `Raz${E_NFD}n social  Caf${E_NFD}`;

    expect(wrapPlainText(line, visibleWidth(line))).toEqual([line]);
  });

  it('respeta los codigos ANSI al cortar', () => {
    const wrapped = wrapPlainText('\u001B[36m東京都港区\u001B[39m', 4);

    expect(wrapped.map(stripAnsi)).toEqual(['東京', '都港', '区']);
    expect(wrapped.join('')).toBe('\u001B[36m東京都港区\u001B[39m');
  });

  it('alinea el valor con una etiqueta con emoji o CJK', () => {
    const wrapped = wrapIndentedPlainText('🧾 Cliente  東京 Café Restaurante Sucursal', 24);

    expect(wrapped).toEqual(['🧾 Cliente  東京 Café', '            Restaurante', '            Sucursal']);
  });
});

describe('wrapIndentedPlainText', () => {
  it('keeps the label when the first word of the value does not fit', () => {
    expect(wrapIndentedPlainText('  Ruta          .../arcli/certificados/123/x.crt', 34)).toEqual([
      '  Ruta          .../arcli/certific',
      '                ados/123/x.crt',
    ]);
  });

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
  const saved = {
    force: process.env.FORCE_COLOR,
    isTty: process.stdout.isTTY,
    noColor: process.env.NO_COLOR,
    term: process.env.TERM,
  };

  function setEnv(
    isTty: boolean | undefined,
    env: { readonly FORCE_COLOR?: string; readonly NO_COLOR?: string; readonly TERM?: string },
  ): void {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: isTty });
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    delete process.env.TERM;
    Object.assign(process.env, env);
  }

  afterEach(() => {
    setEnv(saved.isTty, {});

    if (saved.force !== undefined) process.env.FORCE_COLOR = saved.force;
    if (saved.noColor !== undefined) process.env.NO_COLOR = saved.noColor;
    if (saved.term !== undefined) process.env.TERM = saved.term;
  });

  it('no colorea con TERM=dumb aunque sea una terminal', () => {
    setEnv(true, { TERM: 'dumb' });
    expect(shouldUseColor()).toBe(false);
    expect(colorize('hola', 'info')).toBe('hola');

    setEnv(true, { TERM: 'xterm-256color' });
    expect(shouldUseColor()).toBe(true);
  });

  it('FORCE_COLOR gana sobre TERM=dumb, y NO_COLOR sobre los dos', () => {
    setEnv(true, { FORCE_COLOR: '1', TERM: 'dumb' });
    expect(shouldUseColor()).toBe(true);

    setEnv(true, { FORCE_COLOR: '1', NO_COLOR: '1', TERM: 'dumb' });
    expect(shouldUseColor()).toBe(false);
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

describe('renderForTarget', () => {
  const original = { stderr: process.stderr.isTTY, stdout: process.stdout.isTTY };

  function setTerminals(stdout: boolean, stderr: boolean): void {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: stdout });
    Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: stderr });
  }

  afterEach(() => {
    setTerminals(original.stdout, original.stderr);
  });

  it('decides the color from stderr while rendering for it', () => {
    setTerminals(true, false);

    expect(renderForTarget('stderr', () => colorize('error', 'danger'))).toBe('error');
    expect(colorize('ok', 'success')).not.toBe('ok');
  });

  it('colors an error in the terminal when only stdout is redirected', () => {
    setTerminals(false, true);

    expect(renderForTarget('stderr', () => colorize('error', 'danger'))).not.toBe('error');
    expect(colorize('ok', 'success')).toBe('ok');
  });

  it('goes back to stdout when the render throws', () => {
    setTerminals(true, false);

    expect(() =>
      renderForTarget('stderr', () => {
        throw new Error('fallo');
      }),
    ).toThrow('fallo');
    expect(colorize('ok', 'success')).not.toBe('ok');
  });
});

describe('wrapPanelLines', () => {
  it('stacks every row of a column when one has no room for its value', () => {
    expect(
      wrapPanelLines(
        ['  Etiqueta bastante larga       corto', '  Otra etiqueta bastante larga  un valor largo de verdad'],
        40,
      ),
    ).toEqual([
      '  Etiqueta bastante larga',
      '    corto',
      '  Otra etiqueta bastante larga',
      '    un valor largo de verdad',
    ]);
  });

  it('keeps the columns when the values have room', () => {
    expect(wrapPanelLines(['  Moneda  Pesos argentinos (ARS)', '  CAE     123'], 24)).toEqual([
      '  Moneda  Pesos',
      '          argentinos',
      '          (ARS)',
      '  CAE     123',
    ]);
  });

  it('wraps a label by words, closing its style on each line', () => {
    const bold = (text: string) => `\u001B[1m${text}\u001B[22m`;
    const lines = wrapPanelLines([`  ${bold('Certificado de exportación (testing)')}  no configurado largo`], 22);

    expect(lines.slice(0, 3).map(stripAnsi)).toEqual(['  Certificado de', '  exportación', '  (testing)']);
    expect(lines[0]).toBe(`  ${bold('Certificado de')}`);
  });

  it('aligns the wrapped text of a list item under its text', () => {
    expect(wrapPanelLines(['• Revisá el CUIT del receptor', '1. Un mensaje bastante largo'], 20)).toEqual([
      '• Revisá el CUIT del',
      '  receptor',
      '1. Un mensaje',
      '   bastante largo',
    ]);
  });
});
