import { EXPORT_RULES, type ExportRuleContext } from '../export/export.rules';
import type { ExportCountry, ExportIssuedVoucher, ExportVoucherInput } from '../export/export.types';

import type { ExportInvoiceCopy } from './export-copy';
import type { ExportInputEnv, ExportRuleEnv } from './export-input';
import type { ExportOptions, ExportRuleScope } from './export-optionals';
import { rulesFinalize } from './rule-validator';
import { requireStepValue, type WizardFinalize } from './wizard';

/** Lo que responde quien repite una factura E, con lo copiado de ella. */
export interface ExportRepeatState {
  /** Lo copiado de la factura, con el monto y los items ya ajustados si se cambio el monto. */
  readonly copy?: ExportInvoiceCopy['input'];
  readonly country?: ExportCountry;
  readonly original?: ExportIssuedVoucher;
  readonly options?: ExportOptions;
  readonly paymentDate?: string;
  readonly permits?: readonly string[];
  /** "¿Mismo monto?": si no, se escribe en el paso siguiente. */
  readonly sameAmount?: boolean;
}

/**
 * La entrada de `arcli fe` con lo copiado y lo respondido: de ella salen el comando equivalente y la solicitud a ARCA.
 * La actividad es la de la factura o, si no tenia, la de la config.
 */
export function buildExportRepeatInput(state: ExportRepeatState, env: ExportInputEnv): ExportVoucherInput {
  const copy = requireStepValue(state.copy, 'copy');
  const country = requireStepValue(state.country, 'country');

  return {
    ...copy,
    ...state.options,
    activity: copy.activity ?? env.configuredActivity,
    destinationCountry: country.name,
    emit: false,
    paymentDate: state.paymentDate,
    permits: state.permits,
    permitsExisting: state.permits ? true : undefined,
  };
}

/** Las reglas de la E desde una pregunta de "Repetir": la factura con lo copiado y lo respondido, y hoy. */
export function exportRepeatRuleScope(state: ExportRepeatState, env: ExportRuleEnv): ExportRuleScope {
  return {
    context: { today: env.today },
    draft: (patch) => ({ ...buildExportRepeatInput(state, env), ...patch }),
  };
}

/** `finalize` de "Repetir" una E: las reglas sobre la factura final; sin la copia todavia, no hay entrada. */
export function exportRepeatFinalize(env: () => ExportRuleEnv): WizardFinalize<ExportRepeatState> {
  return rulesFinalize<ExportRepeatState, ExportVoucherInput, ExportRuleContext>({
    context: () => ({ today: env().today }),
    draft: (state) => (state.copy && state.country ? buildExportRepeatInput(state, env()) : undefined),
    rules: EXPORT_RULES,
  });
}
