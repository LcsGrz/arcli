import { Command } from 'commander';

import { registerBillingFamilyCommands } from './commands/billing-family.command';
import { registerBillingShortcutCommands } from './commands/billing-shortcuts.command';
import { registerCertificateCommand } from './commands/certificate.command';
import { registerCompletionCommands } from './commands/completion.command';
import { registerConfigCommand } from './commands/config.command';
import { registerDesktopShortcutCommand } from './commands/desktop-shortcut.command';
import { registerExamplesCommand } from './commands/examples.command';
import { registerExportShortcutCommand } from './commands/export-shortcut.command';
import { registerFceObligationCommand } from './commands/fce-obligation.command';
import { registerInteractiveCommand } from './commands/interactive.command';
import { registerPadronCommand } from './commands/padron.command';
import { registerParametersCommands } from './commands/parameters.command';
import { registerPdfCommand } from './commands/pdf.command';
import { registerStorybookCommand } from './commands/storybook.command';
import { registerVoucherQueryCommands } from './commands/vouchers.command';
import { configureUsageErrors } from './error-output';
import { registerGlobalOptions } from './global-options';
import { configureSpanishHelp, createProgramHeader, createProgramHelp } from './help';
import { warnAboutIgnoredGlobalOptions } from './ignored-global-options';
import { CLI_VERSION } from './version';

export function createProgram(): Command {
  const program = new Command();

  configureUsageErrors(program);

  program
    .name('arcli')
    .description(
      'Emití y revisá comprobantes de ARCA desde la terminal, con validaciones claras y salida lista para automatizar.',
    )
    .version(CLI_VERSION, '-V, --version', 'mostrar la versión instalada')
    .showHelpAfterError('(usá `ayuda` para ver comandos y ejemplos)');

  configureSpanishHelp(program);
  registerGlobalOptions(program);
  warnAboutIgnoredGlobalOptions(program);

  registerBillingShortcutCommands(program);
  registerBillingFamilyCommands(program);
  registerCertificateCommand(program);
  registerCompletionCommands(program);
  registerConfigCommand(program);
  registerDesktopShortcutCommand(program);
  registerExamplesCommand(program);
  registerExportShortcutCommand(program);
  registerFceObligationCommand(program);
  registerInteractiveCommand(program);
  registerPadronCommand(program);
  registerPdfCommand(program);
  registerParametersCommands(program);
  registerVoucherQueryCommands(program);
  registerStorybookCommand(program);

  program.addHelpText('beforeAll', ({ command }) => (command === program ? createProgramHeader() : ''));
  program.addHelpText('afterAll', ({ command }) => (command === program ? createProgramHelp() : ''));

  return program;
}
