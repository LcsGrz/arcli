import type { Command } from 'commander';

import { readJsonFile } from '../../lib/files/read-json-file';
import type { Clock } from '../../lib/time/clock';
import type { BillingDefaults } from '../../modules/billing/billing.defaults';
import { type BillingInputPlan, resolveBillingInputPlan } from '../../modules/billing/billing.input-plan';
import type { VoucherShortcut } from '../../modules/billing/billing.types';
import { systemClock } from '../../services/time/system-clock';

import { readBillingFlags } from './billing.command.flags';

export { registerBillingOptions } from './billing.command.options';

/** Lee los flags y el archivo de `--cargar`; la mezcla con la config y las reglas son de `resolveBillingInputPlan`. */
export function parseBillingCommandPlan(
  command: Command,
  shortcut: VoucherShortcut,
  defaults: BillingDefaults = {},
  clock: Clock = systemClock,
): BillingInputPlan {
  const { cargar } = command.optsWithGlobals<Record<string, unknown>>();

  return resolveBillingInputPlan({
    defaults,
    flags: readBillingFlags(command),
    // Se lee una sola vez: "hoy" es el mismo día para todo el lote, aunque cruce la medianoche.
    now: clock.now(),
    shortcut,
    // Sin asumir la forma: cada ítem se valida con `parseBillingJsonInput` (en un lote, por separado).
    source: typeof cargar === 'string' && cargar ? readJsonFile<unknown>(cargar) : undefined,
  });
}
