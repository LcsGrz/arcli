import { Command } from 'commander';
import { join } from 'node:path';

import { ConfigService } from '../../modules/config/config.service';
import { PdfPlugin } from '../../services/pdf/pdf-plugin';
import {
  formatPdfPluginStatusAsJson,
  formatPdfPluginStatusAsText,
  noticePanel,
  writeTerminalJson,
  writeTerminalOutput,
} from '../../ui';
import { configureSpanishHelp } from '../help';
import { startSpinner } from '../spinner';

function createPlugin(): PdfPlugin {
  const service = new ConfigService();

  try {
    const config = service.getConfig();

    return new PdfPlugin({ configuredBrowser: config.pdfNavegador, path: join(service.getPluginsPath(), 'pdf') });
  } finally {
    service.close();
  }
}

function wantsJson(command: Command): boolean {
  return command.optsWithGlobals<{ json?: boolean }>().json === true;
}

function printStatus(plugin: PdfPlugin, json: boolean | undefined, title?: string): void {
  const status = plugin.getStatus();

  if (json) {
    writeTerminalJson(formatPdfPluginStatusAsJson(status));

    return;
  }

  writeTerminalOutput(formatPdfPluginStatusAsText(status, title));
}

export function registerPdfCommand(program: Command): void {
  const pdfCommand = program
    .command('pdf')
    .description('instalar o revisar el plugin que genera los PDFs de los comprobantes')
    .option('--json', 'imprimir salida JSON')
    .action((_options: unknown, command: Command) => printStatus(createPlugin(), wantsJson(command)));

  configureSpanishHelp(pdfCommand);

  const estadoCommand = pdfCommand
    .command('estado')
    .description('mostrar si el plugin esta instalado, su version y el navegador que usa')
    .option('--json', 'imprimir salida JSON')
    .action((_options: unknown, command: Command) => printStatus(createPlugin(), wantsJson(command)));
  configureSpanishHelp(estadoCommand);

  // Pedir el comando ya es la confirmacion: no se vuelve a preguntar, asi tambien sirve en scripts.
  const instalarCommand = pdfCommand
    .command('instalar')
    .description('descargar el plugin de PDF (~160 MB, o ~360 MB si no hay Chrome instalado)')
    .option('--json', 'imprimir salida JSON')
    .action(async (_options: unknown, command: Command) => {
      const json = wantsJson(command);
      const plugin = createPlugin();
      const spinner = json ? null : startSpinner('Instalando el plugin de PDF...');

      try {
        await plugin.install((message) => {
          if (spinner) {
            spinner.text = message;
          }
        });
      } finally {
        spinner?.stop();
      }

      printStatus(plugin, json, 'Plugin de PDF instalado');
    });
  configureSpanishHelp(instalarCommand);

  const desinstalarCommand = pdfCommand
    .command('desinstalar')
    .description('borrar el plugin de PDF y el navegador que haya descargado')
    .option('--json', 'imprimir salida JSON')
    .action((_options: unknown, command: Command) => {
      const plugin = createPlugin();

      plugin.uninstall();

      if (wantsJson(command)) {
        writeTerminalJson(JSON.stringify({ desinstalado: true, ruta: plugin.getStatus().path }, null, 2));

        return;
      }

      writeTerminalOutput(noticePanel('Plugin de PDF desinstalado.', 'success'));
    });
  configureSpanishHelp(desinstalarCommand);
}
