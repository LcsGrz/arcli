import { describe, expect, it } from 'vitest';

import { formatShellCommand, quoteShellArgument } from '../shell-argument';

describe('quoteShellArgument en POSIX (bash, zsh, fish)', () => {
  const quote = (value: string) => quoteShellArgument(value, 'linux');

  it('deja sin comillas lo que la shell no interpreta', () => {
    expect(quote('--pv')).toBe('--pv');
    expect(quote('3')).toBe('3');
    expect(quote('1500,50')).toBe('1500,50');
    expect(quote('31/10')).toBe('31/10');
    expect(quote('21:100,50')).toBe('21:100,50');
  });

  it.each([
    ['Hola!', "'Hola!'"],
    ['$HOME', "'$HOME'"],
    ['a`b`', "'a`b`'"],
    ['ACME "B"', `'ACME "B"'`],
    ['ACME S.A.', "'ACME S.A.'"],
    ['', "''"],
    ['Muñoz', "'Muñoz'"],
    ['Pago a 30 días', "'Pago a 30 días'"],
    ['a\\b', "'a\\b'"],
  ])('%j va entre comillas simples, sin escapar nada adentro', (value, expected) => {
    expect(quote(value)).toBe(expected);
  });

  it("cierra, escapa y reabre la comilla simple: '\\''", () => {
    expect(quote("O'Brien")).toBe("'O'\\''Brien'");
    expect(quote("'")).toBe("''\\'''");
  });

  it('no usa la ruta de Windows en macOS', () => {
    expect(quoteShellArgument("O'Brien", 'darwin')).toBe("'O'\\''Brien'");
  });
});

describe('quoteShellArgument en win32 (PowerShell)', () => {
  const quote = (value: string) => quoteShellArgument(value, 'win32');

  it('deja sin comillas lo que PowerShell no interpreta', () => {
    expect(quote('--pv')).toBe('--pv');
    expect(quote('3')).toBe('3');
    expect(quote('31/10')).toBe('31/10');
    expect(quote('1500,50')).toBe('1500,50');
  });

  it.each([
    ['Hola!', "'Hola!'"],
    ['$HOME', "'$HOME'"],
    ['a`b`', "'a`b`'"],
    ['ACME "B"', `'ACME "B"'`],
    ['ACME S.A.', "'ACME S.A.'"],
    ['', "''"],
    ['Muñoz', "'Muñoz'"],
    ['Pago a 30 días', "'Pago a 30 días'"],
  ])('%j va entre comillas simples, sin escapar nada adentro', (value, expected) => {
    expect(quote(value)).toBe(expected);
  });

  it('duplica la comilla simple, también las tipográficas', () => {
    expect(quote("O'Brien")).toBe("'O''Brien'");
    expect(quote('O’Brien')).toBe("'O’’Brien'");
  });
});

describe('formatShellCommand', () => {
  it('une los argumentos con comillas solo donde hacen falta', () => {
    const args = ['arcli', 'fc', '-m', '1500,50', '--receptor-nombre', 'Hola! $HOME', '--emitir'];

    expect(formatShellCommand(args, 'linux')).toBe("arcli fc -m 1500,50 --receptor-nombre 'Hola! $HOME' --emitir");
    expect(formatShellCommand(args, 'win32')).toBe("arcli fc -m 1500,50 --receptor-nombre 'Hola! $HOME' --emitir");
  });
});
