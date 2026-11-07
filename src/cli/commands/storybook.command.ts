import type { Command } from 'commander';

import { InputValidationError } from '../../lib/errors/app-error';
import { renderStorybookShowcase, type StorybookScene } from '../../modules/storybook/showcase';
import { writeTerminalOutput } from '../../ui';
import { configureSpanishHelp, createStorybookHelp } from '../help';
import { CLI_VERSION } from '../version';

const STORYBOOK_SCENES: StorybookScene[] = [
  'bordes',
  'certificados',
  'colores',
  'componentes',
  'comprobantes',
  'configuracion',
  'consultas',
  'errores',
  'json',
];

export function registerStorybookCommand(program: Command): void {
  const command = program
    // Herramienta de desarrollo: funciona, pero no se lista en la ayuda.
    .command('storybook', { hidden: true })
    .description('ver escenas visuales del CLI con datos de ejemplo')
    .argument(
      '[escena]',
      'bordes, certificados, comprobantes, colores, componentes, configuración, consultas, errores o json',
    )
    .action((scene?: string) => {
      if (scene && !STORYBOOK_SCENES.includes(scene as StorybookScene)) {
        throw new InputValidationError(
          `La escena "${scene}" no es válida. Usá bordes, certificados, comprobantes, colores, componentes, configuración, consultas, errores o json.`,
        );
      }

      writeTerminalOutput(renderStorybookShowcase(scene as StorybookScene | undefined, CLI_VERSION));
    })
    .addHelpText('after', createStorybookHelp());

  configureSpanishHelp(command);
}
