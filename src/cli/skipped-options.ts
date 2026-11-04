import type { Command, Option } from 'commander';

/**
 * `arcli factura <letra>` comparte un solo comando para A, B, C y E, asi que acepta los flags de todas las letras.
 * Los que se pasaron y no aplican a la letra elegida no cortan la ejecucion: se saltean con un aviso.
 */
export function findPassedOptions(command: Command, options: readonly Option[]): string[] {
  return options
    .filter((option) => command.getOptionValueSource(option.attributeName()) === 'cli')
    .map((option) => option.long ?? option.short ?? option.flags);
}

export function formatSkippedOptionsWarning(flags: readonly string[], voucherLabel: string): string {
  return flags.length === 1
    ? `${flags[0]} no aplica a ${voucherLabel} y se salteó.`
    : `Estos flags no aplican a ${voucherLabel} y se saltearon: ${flags.join(', ')}.`;
}
