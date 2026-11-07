import { afterEach, describe, expect, it, vi } from 'vitest';

import { hyperlink } from '../../primitives/hyperlink';
import { formatTerminalOutput, sanitizeTerminalText, writeTerminalNotice } from '../terminal-stream';

const ESC = '\u001B';

describe('formatTerminalOutput with json', () => {
  const json = JSON.stringify({ cae: '12345678901234', total: 100, ok: true, error: null }, null, 2);

  const originalIsTTY = { stdout: process.stdout.isTTY, stderr: process.stderr.isTTY };

  function setIsTTY(target: 'stderr' | 'stdout', value: boolean): void {
    Object.defineProperty(process[target], 'isTTY', { configurable: true, value });
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    setIsTTY('stdout', originalIsTTY.stdout);
    setIsTTY('stderr', originalIsTTY.stderr);
  });

  it.each(['stdout', 'stderr'] as const)(
    'keeps %s parseable when FORCE_COLOR is set and it is not a terminal',
    (target) => {
      vi.stubEnv('FORCE_COLOR', '1');
      vi.stubEnv('NO_COLOR', '');
      setIsTTY(target, false);

      const output = formatTerminalOutput(json, { json: true, target });

      expect(output).not.toContain(ESC);
      expect(JSON.parse(output)).toEqual(JSON.parse(json));
    },
  );

  it('highlights json in a terminal', () => {
    vi.stubEnv('FORCE_COLOR', '1');
    vi.stubEnv('NO_COLOR', '');
    setIsTTY('stdout', true);

    expect(formatTerminalOutput(json, { json: true, target: 'stdout' })).toContain(ESC);
  });
});

describe('sanitizeTerminalText', () => {
  it('keeps colors, line breaks and tabs', () => {
    const text = `${ESC}[1m${ESC}[38;2;255;0;0mPRODUCCION${ESC}[39m${ESC}[22m\n\tok`;

    expect(sanitizeTerminalText(text)).toBe(text);
  });

  it.each([
    ['cursor up and clear line', `ok${ESC}[1A${ESC}[2Kfalso`, 'okfalso'],
    ['clear screen', `${ESC}[2J${ESC}[Hhola`, 'hola'],
    ['carriage return that overwrites the line', 'PRODUCCION\rTESTING   ', 'PRODUCCIONTESTING   '],
    ['OSC 8 hyperlink that arcli did not create', `${ESC}]8;;https://malo.example${ESC}\\clic`, 'clic'],
    ['window title with BEL', `${ESC}]0;titulo\u0007texto`, 'texto'],
    ['bare ESC and C1 CSI', `a${ESC}cb\u009B2Jc`, 'ab2Jc'],
    ['other control characters', 'a\u0000b\u0007c\u007Fd', 'abcd'],
  ])('removes %s', (_, input, expected) => {
    expect(sanitizeTerminalText(input)).toBe(expected);
  });

  it('keeps the hyperlinks arcli creates, and their closing sequence', () => {
    process.env.FORCE_HYPERLINK = '1';

    try {
      const link = hyperlink('guía', 'https://github.com/LcsGrz/arcli');

      expect(link).toContain(`${ESC}]8;;https://github.com/LcsGrz/arcli`);
      expect(sanitizeTerminalText(`ver ${link}`)).toBe(`ver ${link}`);
      expect(sanitizeTerminalText(`${ESC}]8;;https://malo.example${ESC}\\guía${ESC}]8;;${ESC}\\`)).toBe(
        `guía${ESC}]8;;${ESC}\\`,
      );
    } finally {
      delete process.env.FORCE_HYPERLINK;
    }
  });

  it('is applied to everything written to the terminal', () => {
    expect(formatTerminalOutput(`Observacion: ${ESC}[2Jlimpio`)).toBe('\nObservacion: limpio\n\n');
  });
});

describe('writeTerminalNotice', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes nothing when there is no text', () => {
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    writeTerminalNotice(() => null);

    expect(write).not.toHaveBeenCalled();
  });

  it('writes the notice to stderr', () => {
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    writeTerminalNotice(() => 'aviso');

    expect(write).toHaveBeenCalledWith('\naviso\n');
  });
});
