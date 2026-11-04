import type { Command, Option } from 'commander';

import { InputValidationError } from '../../lib/errors/app-error';
import type { VoucherLetter } from '../../modules/billing/billing.types';
import {
  getVoucherFamilyLetters,
  getVoucherKindByFamilyAndLetter,
  VOUCHER_FAMILIES,
  VOUCHER_KIND_MAP,
} from '../../modules/billing/voucher-kind-map';
import { EXPORT_VOUCHER_KIND } from '../../modules/export/export.types';
import { configureSpanishHelp, createFamilyHelp } from '../help';
import { GLOBAL_OPTION_FLAGS } from '../ignored-global-options';
import { findPassedOptions, formatSkippedOptionsWarning } from '../skipped-options';

import { hideInapplicableBillingOptions } from './billing.command.options';
import { executeBillingCommand, registerBillingCommandOptions } from './billing.command.shared';
import { executeExportCommand } from './export.command';
import { EXPORT_OPTION_FLAGS, registerExportOptions } from './export.command.options';

function skippedWarnings(command: Command, options: readonly Option[], voucherLabel: string): string[] {
  const flags = findPassedOptions(command, options);

  return flags.length > 0 ? [formatSkippedOptionsWarning(flags, voucherLabel)] : [];
}

/** `a, b o c`, o solo `c` si la familia tiene una letra. */
function formatLetters(letters: readonly string[]): string {
  return letters.length === 1 ? (letters[0] ?? '') : `${letters.slice(0, -1).join(', ')} o ${letters.at(-1)}`;
}

export function registerBillingFamilyCommands(program: Command): void {
  for (const family of VOUCHER_FAMILIES) {
    const definitions = Object.values(VOUCHER_KIND_MAP).filter((definition) => definition.family === family);
    const familyShortcuts = definitions.map((definition) => definition.shortcut).join(', ');
    // La familia `factura` tambien acepta la letra E, que se emite por WSFEX.
    const supportsExport = family === EXPORT_VOUCHER_KIND.family;
    const shortcuts = supportsExport ? `${familyShortcuts}, ${EXPORT_VOUCHER_KIND.shortcut}` : familyShortcuts;
    // `recibo` solo tiene la C.
    const letters: readonly string[] = supportsExport
      ? [...getVoucherFamilyLetters(family), EXPORT_VOUCHER_KIND.letter]
      : getVoucherFamilyLetters(family);
    const command = program
      .command(family, { hidden: true })
      .description(
        `usar ${family} por letra ${formatLetters(letters.map((letter) => letter.toUpperCase()))} con ejemplos y atajos${shortcuts ? ` (${shortcuts})` : ''}`,
      )
      .argument('<letra>', 'letra del comprobante', (value: string) => value.toLowerCase());

    configureSpanishHelp(command);

    registerBillingCommandOptions(command);
    hideInapplicableBillingOptions(command, {
      isElectronicCredit: definitions.some((definition) => definition.isElectronicCredit),
      isNote: definitions.some((definition) => definition.requiresAssociatedVoucher),
      letters: definitions.map((definition) => definition.letter),
    });

    // Un solo comando para A, B, C y E: acepta los flags de todas y saltea con un aviso los que no aplican a la letra.
    const billingOnlyOptions = command.options.filter(
      (option) =>
        !EXPORT_OPTION_FLAGS.has(option.long ?? '') &&
        !(GLOBAL_OPTION_FLAGS as readonly string[]).includes(option.long ?? ''),
    );
    const exportOnlyOptions = supportsExport ? registerExportOptions(command, { hidden: true }) : [];

    command.action(async (letter: string) => {
      if (supportsExport && letter === EXPORT_VOUCHER_KIND.letter) {
        await executeExportCommand(command, {
          extraWarnings: skippedWarnings(command, billingOnlyOptions, EXPORT_VOUCHER_KIND.displayName),
        });

        return;
      }

      if (!letters.includes(letter)) {
        throw new InputValidationError(`La letra "${letter}" no es válida. Usá ${formatLetters(letters)}.`);
      }

      const definition = getVoucherKindByFamilyAndLetter(family, letter as VoucherLetter);

      if (!definition) {
        throw new InputValidationError(`No existe un comprobante para la familia "${family}" y letra "${letter}".`);
      }

      await executeBillingCommand(command, definition.shortcut, {
        extraWarnings: skippedWarnings(command, exportOnlyOptions, definition.displayName),
      });
    });

    command.addHelpText('after', createFamilyHelp(family));
  }
}
