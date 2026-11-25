import type { Command } from 'commander';

import { readJsonFile } from '../../lib/files/read-json-file';
import type { Clock } from '../../lib/time/clock';
import { type ExportInputOptions, type ExportInputPlan, resolveExportInput } from '../../modules/export/export.input';
import { readExportJsonInput } from '../../modules/export/export.json-input';
import { EXPORT_VOUCHER_KIND } from '../../modules/export/export.kinds';
import { systemClock } from '../../services/time/system-clock';

import { readExportFlags } from './export.command.flags';

/** Lee los flags y el archivo de `--cargar`; la mezcla con la config y las reglas son de `resolveExportInput`. */
export function parseExportCommandPlan(
  command: Command,
  {
    defaultEmit,
    emitterCuit,
    voucherKind = EXPORT_VOUCHER_KIND,
  }: Pick<ExportInputOptions, 'defaultEmit' | 'emitterCuit' | 'voucherKind'> = {},
  clock: Clock = systemClock,
): ExportInputPlan {
  const { cargar } = command.optsWithGlobals<Record<string, unknown>>();

  return resolveExportInput({
    defaultEmit,
    emitterCuit,
    file: typeof cargar === 'string' && cargar ? readExportJsonInput(readJsonFile<unknown>(cargar)) : undefined,
    flags: readExportFlags(command, voucherKind),
    now: clock.now(),
    voucherKind,
  });
}
