import type { Command, Option } from 'commander';
import { expect, it } from 'vitest';

import { VOUCHER_FAMILIES } from '../../modules/billing/voucher-kind-map';
import { createProgram } from '../program';
import { familyScope } from '../voucher-scope';

/**
 * Lo que la ayuda de cada comprobante decide por su alcance (letras, nota, FCE): las opciones que muestra, las que
 * oculta y sus reglas (ARQ8-15). No es contrato: no va en `__golden__/`. Para regenerarlo a propósito:
 * `yarn test src/cli/__tests__/voucher-help.scope.test.ts -u`, y revisar el diff.
 */

/** Los comandos que emiten, tal como están registrados: uno de más o de menos cambia el archivo. */
function voucherCommands(): Command[] {
  return createProgram().commands.filter((command) => command.options.some((option) => option.long === '--emitir'));
}

/** Las líneas de "Reglas" de la ayuda, como salen por stdout; la E no tiene. */
function ruleLines(command: Command): string[] {
  let output = '';

  command.configureOutput({
    getOutHasColors: () => false,
    writeOut: (text) => {
      output += text;
    },
  });
  command.outputHelp();

  return (output.split('\nReglas\n')[1] ?? '').split('\n').filter((line) => line.startsWith('  - '));
}

function flags(options: readonly Option[]): string {
  return options.map((option) => option.long ?? option.flags).join(' ');
}

it('cada comprobante muestra, oculta y explica lo de su alcance', async () => {
  const rules: string[] = [];
  const groups = new Map<string, string[]>();

  for (const command of voucherCommands()) {
    const lines = ruleLines(command);

    rules.push(...lines.filter((line) => !rules.includes(line)));

    const result = [
      `  visibles: ${flags(command.options.filter((option) => !option.hidden))}`,
      `  ocultas: ${flags(command.options.filter((option) => option.hidden))}`,
      `  reglas: ${lines.map((line) => rules.indexOf(line) + 1).join(' ') || 'ninguna'}`,
    ].join('\n');

    groups.set(result, [...(groups.get(result) ?? []), command.name()]);
  }

  const text = [
    'Reglas',
    ...rules.map((line, index) => `${index + 1}. ${line.slice('  - '.length)}`),
    ...[...groups].map(([result, names]) => `\n${names.join(', ')}\n${result}`),
    '',
  ].join('\n');

  await expect(text).toMatchFileSnapshot('voucher-help.scope.txt');
});

// La ayuda de la familia solo mira si alguna letra discrimina IVA: que estén las tres se afirma acá.
it.each(VOUCHER_FAMILIES)('el alcance de %s tiene todas sus letras', (family) => {
  expect(familyScope(family).letters).toEqual(['a', 'b', 'c']);
});
