import type { Command } from 'commander';

import { EXPORT_VOUCHER_KINDS } from '../../modules/export/export.types';
import { registerGlobalOptions } from '../global-options';
import { configureSpanishHelp, createExportShortcutHelp } from '../help';

import { executeExportCommand } from './export.command';
import { registerExportOptions } from './export.command.options';

/**
 * `arcli fe`, `arcli nde` y `arcli nce`: los atajos de la E, como `fa`, `ndb` o `ncc`. Son lo mismo que
 * `arcli factura e`, `arcli nota-debito e` y `arcli nota-credito e`.
 */
export function registerExportShortcutCommand(program: Command): void {
  for (const voucherKind of EXPORT_VOUCHER_KINDS) {
    // Oculto en la lista de comandos: la ayuda principal lo muestra en la tabla de atajos.
    const command = program
      .command(voucherKind.shortcut, { hidden: true })
      .description(`${voucherKind.displayName} por atajo (WSFEX), con ayuda guiada para previsualizar o emitir`);

    configureSpanishHelp(command);
    registerGlobalOptions(command);
    registerExportOptions(command, voucherKind);

    command.action(async () => {
      await executeExportCommand(command, { voucherKind });
    });

    command.addHelpText('after', createExportShortcutHelp(voucherKind));
  }
}
