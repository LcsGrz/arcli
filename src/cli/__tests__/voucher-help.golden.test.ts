import type { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VOUCHER_FAMILIES, VOUCHER_SHORTCUTS } from '../../modules/billing/voucher-kind-map';
import { EXPORT_VOUCHER_KINDS } from '../../modules/export/export.types';
import { createProgram } from '../program';

/**
 * Caracterización de ARQ8-15: la ayuda completa de cada comprobante y qué opciones oculta, según el alcance del comando
 * (letras, nota, FCE). Cada comando se compara con su archivo en `__golden__/ayuda/`. Para regenerarlos a propósito:
 * `yarn test src/cli/__tests__/voucher-help.golden.test.ts -u`, y revisar el diff.
 */

const COMMANDS = [...VOUCHER_FAMILIES, ...VOUCHER_SHORTCUTS, ...EXPORT_VOUCHER_KINDS.map((kind) => kind.shortcut)];

function findCommand(name: string): Command {
  const command = createProgram().commands.find((candidate) => candidate.name() === name);

  if (!command) {
    throw new Error(`no existe el comando ${name}`);
  }

  return command;
}

/** La ayuda como sale por stdout, con los textos de antes y de después; ancho fijo y sin color, como en CI. */
function helpText(command: Command): string {
  let output = '';

  command.configureOutput({
    getOutHasColors: () => false,
    getOutHelpWidth: () => 100,
    writeOut: (text) => {
      output += text;
    },
  });
  command.outputHelp();

  return output;
}

function hiddenOptions(command: Command): string[] {
  return command.options.filter((option) => option.hidden).map((option) => option.flags);
}

describe('ayuda de cada comprobante', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T15:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(COMMANDS)('%s: ayuda completa y opciones ocultas', async (name) => {
    const command = findCommand(name);
    const text = [
      `$ arcli ${name} --ayuda`,
      helpText(command),
      '--- opciones ocultas ---',
      ...hiddenOptions(command),
      '',
    ].join('\n');

    await expect(text).toMatchFileSnapshot(`__golden__/ayuda/${name}.txt`);
  });
});
