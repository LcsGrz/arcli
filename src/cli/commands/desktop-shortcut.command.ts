import type { Command } from 'commander';

import {
  formatDesktopShortcutAsText,
  serializeDesktopShortcut,
} from '../../modules/desktop-shortcut/desktop-shortcut.presenter';
import { createDesktopShortcut, currentDesktopShortcutEnvironment } from '../../modules/desktop-shortcut/installer';
import { writeTerminalJson, writeTerminalOutput } from '../../ui';
import { withConfigService } from '../config-service';
import { registerJsonOption, resolveOutputJson } from '../global-options';
import { configureSpanishHelp } from '../help';

export function registerDesktopShortcutCommand(program: Command): void {
  const command = registerJsonOption(
    program
      .command('acceso-directo')
      .description('crear un acceso directo con ícono para abrir ARCLI con doble clic')
      .argument('[ruta]', 'carpeta donde crearlo; por defecto, el escritorio'),
  ).action((folder: string | undefined, _options: unknown, self: Command) => {
    const { configPath, json } = withConfigService((service) => ({
      configPath: service.getPath(),
      json: resolveOutputJson(self, service.getConfig()),
    }));

    const result = createDesktopShortcut(folder, currentDesktopShortcutEnvironment(configPath));

    if (json) {
      writeTerminalJson(serializeDesktopShortcut(result));
    } else {
      writeTerminalOutput(formatDesktopShortcutAsText(result));
    }
  });

  configureSpanishHelp(command);
}
