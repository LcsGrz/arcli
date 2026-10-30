import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createProgram } from '../program';
import { findPassedOptions, formatSkippedOptionsWarning } from '../skipped-options';

const calls: Array<{ kind: 'billing' | 'export'; warnings: readonly string[] }> = [];

vi.mock('../commands/billing.command.shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('../commands/billing.command.shared')>();

  return {
    ...original,
    executeBillingCommand: async (_command: Command, _shortcut: string, options: { extraWarnings?: string[] } = {}) => {
      calls.push({ kind: 'billing', warnings: options.extraWarnings ?? [] });
    },
  };
});

vi.mock('../commands/export.command', async (importOriginal) => {
  const original = await importOriginal<typeof import('../commands/export.command')>();

  return {
    ...original,
    executeExportCommand: async (_command: Command, options: { extraWarnings?: string[] } = {}) => {
      calls.push({ kind: 'export', warnings: options.extraWarnings ?? [] });
    },
  };
});

async function run(...args: string[]): Promise<void> {
  const program = createProgram();
  const silence = (command: Command) => {
    command.exitOverride().configureOutput({ writeErr: () => {}, writeOut: () => {} });
    command.commands.forEach(silence);
  };

  silence(program);
  await program.parseAsync(['node', 'arcli', ...args]);
}

describe('formatSkippedOptionsWarning', () => {
  it('nombra el flag o la lista de flags salteados', () => {
    expect(formatSkippedOptionsWarning(['--incoterm'], 'Factura A')).toBe(
      '--incoterm no aplica a Factura A y se salteó.',
    );
    expect(formatSkippedOptionsWarning(['--incoterm', '--tipo-expo'], 'Factura A')).toBe(
      'Estos flags no aplican a Factura A y se saltearon: --incoterm, --tipo-expo.',
    );
  });
});

describe('findPassedOptions', () => {
  it('solo cuenta lo que vino por linea de comandos, no los defaults', () => {
    const command = new Command().option('--uno <valor>', '', 'default').option('--dos').option('--tres');

    command.parse(['--dos'], { from: 'user' });

    expect(findPassedOptions(command, command.options)).toEqual(['--dos']);
  });
});

describe('arcli factura <letra> con flags de otra letra', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('en A, B y C saltea los flags de la E con un aviso', async () => {
    await run('factura', 'a', '-m', '100', '--incoterm', 'FOB', '--tipo-expo', '1');

    expect(calls).toEqual([
      { kind: 'billing', warnings: ['Estos flags no aplican a Factura A y se saltearon: --tipo-expo, --incoterm.'] },
    ]);
  });

  it('en la E saltea los flags de A, B y C con un aviso', async () => {
    await run('factura', 'e', '-m', '100', '--alicuota', '21', '--cs');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.kind).toBe('export');
    expect(calls[0]?.warnings).toEqual([
      expect.stringMatching(/^Estos flags no aplican a Factura de exportación E y se saltearon: .*--alicuota/),
    ]);
    expect(calls[0]?.warnings[0]).toContain('--cs');
  });

  it('no avisa nada con los flags que comparten (monto, fecha, moneda, salida)', async () => {
    await run('factura', 'e', '-m', '100', '--fecha', '1', '--moneda', 'USD', '--json', '--testing');
    await run('factura', 'c', '-m', '100', '--fecha', '1', '--moneda', 'USD', '--json', '--testing');

    expect(calls.map((call) => call.warnings)).toEqual([[], []]);
  });

  it('los atajos son estrictos: fe no acepta flags de A, B y C', async () => {
    await expect(run('fe', '-m', '100', '--alicuota', '21')).rejects.toThrow(/--alicuota/);
    expect(calls).toEqual([]);
  });
});
