import type { Command } from 'commander';

import { renderExamples } from '../../modules/examples/examples';
import { writeTerminalOutput } from '../../ui';
import { configureSpanishHelp, createExamplesHelp } from '../help';
import { CLI_VERSION } from '../version';

export function registerExamplesCommand(program: Command): void {
  const command = program
    .command('ejemplos')
    .description('ver ejemplos listos para copiar de todos los comprobantes')
    .action(() => {
      writeTerminalOutput(renderExamples(new Date(), CLI_VERSION));
    })
    .addHelpText('after', createExamplesHelp());

  configureSpanishHelp(command);
}
