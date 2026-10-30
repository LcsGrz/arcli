import type { Command } from 'commander';

import { EXPORT_VOUCHER_KIND } from '../../modules/export/export.types';
import { registerGlobalOptions } from '../global-options';
import { configureSpanishHelp, createExportShortcutHelp } from '../help';

import { executeExportCommand } from './export.command';
import { registerExportOptions } from './export.command.options';

/** `arcli fe`: el atajo de la factura E, como `fa`, `fb` y `fc`. Es lo mismo que `arcli factura e`. */
export function registerExportShortcutCommand(program: Command): void {
  // Oculto en la lista de comandos: la ayuda principal lo muestra en la tabla de atajos.
  const command = program
    .command(EXPORT_VOUCHER_KIND.shortcut, { hidden: true })
    .description(
      `${EXPORT_VOUCHER_KIND.displayName} por shortcut (WSFEX), con ayuda guiada para previsualizar o emitir`,
    );

  configureSpanishHelp(command);
  registerGlobalOptions(command);
  registerExportOptions(command);

  command.action(async () => {
    await executeExportCommand(command);
  });

  command.addHelpText('after', createExportShortcutHelp());
}
