import type { Command } from 'commander';

import { InputValidationError } from '../../lib/errors/app-error';
import type { VoucherLetter } from '../../modules/billing/billing.types';
import {
  getVoucherKindByFamilyAndLetter,
  VOUCHER_FAMILIES,
  VOUCHER_KIND_MAP,
  VOUCHER_LETTERS,
} from '../../modules/billing/voucher-kind-map';
import { configureSpanishHelp, createFamilyHelp } from '../help';

import { executeBillingCommand, registerBillingCommandOptions } from './billing.command.shared';
import { executeExportCommand } from './export.command';
import { registerExportOptions } from './export.command.options';

export function registerBillingFamilyCommands(program: Command): void {
  for (const family of VOUCHER_FAMILIES) {
    const familyShortcuts = Object.values(VOUCHER_KIND_MAP)
      .filter((definition) => definition.family === family)
      .map((definition) => definition.shortcut)
      .join(', ');
    // La familia `factura` tambien acepta la letra E, que se emite por WSFEX con su propio comando.
    const supportsExport = family === 'factura';
    const command = program
      .command(family)
      .description(
        `usar ${family} por letra A, B o C${supportsExport ? ' o E' : ''} con ejemplos y atajos${familyShortcuts ? ` (${familyShortcuts})` : ''}`,
      )
      .argument('<letra>', 'letra del comprobante', (value: string) => value.toLowerCase());

    configureSpanishHelp(command);

    registerBillingCommandOptions(command);

    if (supportsExport) {
      registerExportOptions(command, { hidden: true });
    }

    command.action(async (letter: string) => {
      if (supportsExport && letter === 'e') {
        await executeExportCommand(command);

        return;
      }

      if (!VOUCHER_LETTERS.includes(letter as VoucherLetter)) {
        throw new InputValidationError(
          `La letra "${letter}" no es valida. Use a, b o c${supportsExport ? ' o e' : ''}.`,
        );
      }

      const definition = getVoucherKindByFamilyAndLetter(family, letter as VoucherLetter);

      if (!definition) {
        throw new InputValidationError(`No existe un comprobante para la familia "${family}" y letra "${letter}".`);
      }

      await executeBillingCommand(command, definition.shortcut);
    });

    command.addHelpText('after', createFamilyHelp(family));
  }
}
