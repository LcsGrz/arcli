import type { Command } from 'commander';

import { VOUCHER_KIND_MAP, VOUCHER_SHORTCUTS } from '../../modules/billing/voucher-kind-map';
import { configureSpanishHelp, createShortcutHelp } from '../help';

import { executeBillingCommand, registerBillingCommandOptions } from './billing.command.shared';

export function registerBillingShortcutCommands(program: Command): void {
  for (const shortcut of VOUCHER_SHORTCUTS) {
    const definition = VOUCHER_KIND_MAP[shortcut];
    const command = program
      .command(shortcut)
      .description(`${definition.displayName} por shortcut, con ayuda guiada para previsualizar o emitir`);

    configureSpanishHelp(command);

    registerBillingCommandOptions(command);

    command.action(async () => {
      await executeBillingCommand(command, shortcut);
    });

    command.addHelpText('after', createShortcutHelp(shortcut));
  }
}
