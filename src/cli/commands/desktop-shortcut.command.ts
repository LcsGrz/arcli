import type { Command } from 'commander';

import { ConfigService } from '../../modules/config/config.service';
import {
  formatDesktopShortcutAsJson,
  formatDesktopShortcutAsText,
} from '../../modules/desktop-shortcut/desktop-shortcut.presenter';
import { createDesktopShortcut, currentDesktopShortcutEnvironment } from '../../modules/desktop-shortcut/installer';
import { writeTerminalJson, writeTerminalOutput } from '../../ui';
import { registerJsonOption, resolveOutputJson } from '../global-options';
import { configureSpanishHelp } from '../help';

export function registerDesktopShortcutCommand(program: Command): void {
  const command = registerJsonOption(
    program
      .command('acceso-directo')
      .description('crear un acceso directo con ícono para abrir ARCLI con doble clic')
      .argument('[ruta]', 'carpeta donde crearlo; por defecto, el escritorio'),
  ).action((folder: string | undefined, _options: unknown, self: Command) => {
    const service = new ConfigService();
    let json: boolean;
    let configPath: string;

    try {
      json = resolveOutputJson(self, service.getConfig());
      configPath = service.getPath();
    } finally {
      service.close();
    }

    const result = createDesktopShortcut(folder, currentDesktopShortcutEnvironment(configPath));

    if (json) {
      writeTerminalJson(formatDesktopShortcutAsJson(result));
    } else {
      writeTerminalOutput(formatDesktopShortcutAsText(result));
    }
  });

  configureSpanishHelp(command);
}
