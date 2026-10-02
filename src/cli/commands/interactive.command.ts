import type { Command } from 'commander';

import { InputValidationError } from '../../lib/errors/app-error';
import { configureSpanishHelp } from '../help';
import { runInteractiveMode } from '../interactive/interactive-mode';

import { getGlobalOptions, registerGlobalOptions } from './billing.command.shared';

export function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function registerInteractiveCommand(program: Command): void {
  const command = program
    .command('interactivo')
    .description('asistente paso a paso para emitir comprobantes; tambien se abre con "arcli" sin argumentos');

  registerGlobalOptions(command);
  configureSpanishHelp(command);

  command.action(async (_options: unknown, self: Command) => {
    const options = getGlobalOptions(self);

    if (options.json || !isInteractiveTerminal()) {
      throw new InputValidationError(
        'El modo interactivo necesita una terminal interactiva y no admite --json. Use los comandos con flags.',
      );
    }

    await runInteractiveMode(options);
  });
}
