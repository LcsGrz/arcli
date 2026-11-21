import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';

import { dateInputHint } from '../../../lib/dates/date-input-text';
import { InputValidationError } from '../../../lib/errors/app-error';
import { createArcaQuery } from '../../arca-query';
import { registerFceObligationCommand } from '../fce-obligation.command';

vi.mock('../../arca-query', () => ({
  createArcaQuery: vi.fn(),
  withQuerySpinner: vi.fn(),
  writeQueryOutput: vi.fn(),
}));

async function run(argv: string[]): Promise<unknown> {
  const program = new Command().exitOverride();

  program.option('--json').option('--testing').option('--produccion');
  registerFceObligationCommand(program);

  try {
    await program.parseAsync(['node', 'arcli', 'fce-obligado', ...argv]);

    return undefined;
  } catch (error) {
    return error;
  }
}

describe('fce-obligado --fecha', () => {
  // TUI-18: el mismo texto de formatos que los flags de facturacion y el asistente, sin llegar a ARCA.
  it('una fecha que no existe da INPUT_VALIDATION_ERROR con el texto comun de formatos', async () => {
    const error = await run(['20-11111111-2', '--fecha', '31/02']);

    expect(error).toBeInstanceOf(InputValidationError);
    expect((error as InputValidationError).code).toBe('INPUT_VALIDATION_ERROR');
    expect((error as Error).message).toBe(`La fecha "31/02" no es válida. ${dateInputHint()}`);
    expect(createArcaQuery).not.toHaveBeenCalled();
  });
});
