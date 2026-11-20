import { EXPORT_RULES, type ExportRuleContext } from '../export/export.rules';
import type { ExportCountry, ExportType, ExportVoucherInput } from '../export/export.types';

import type { ExportOptions, ExportRuleScope } from './export-optionals';
import { rulesFinalize } from './rule-validator';
import type { WizardFinalize } from './wizard';

/** Lo que responde quien emite una factura E con "Emitir factura". */
export interface ExportFlowState {
  readonly activity?: number;
  readonly amount?: number;
  readonly clientAddress?: string;
  readonly clientName?: string;
  readonly clientTaxId?: string;
  /** El destino como esta en la tabla de ARCA, para el CUIT del pais. */
  readonly country?: ExportCountry;
  /** ARCA no publica un CUIT para el destino: hay que pedirlo (`--cuit-pais`). */
  readonly countryCuitMissing?: boolean;
  readonly currencyCode?: 'DOL' | 'PES';
  readonly description?: string;
  readonly destinationCountry?: string;
  /** La cotizacion escrita a mano; sin ella, la de aduana de ARCA, como el CLI sin `--cm`. */
  readonly exchangeRate?: number;
  readonly exportType?: ExportType;
  readonly incoterm?: string;
  /** Nombre del incoterm en la tabla de ARCA: la descripcion que va si no se escribe otra. */
  readonly incotermName?: string;
  readonly options: ExportOptions;
  readonly paymentDate?: string;
  readonly paymentTerms?: string;
  readonly permits?: readonly string[];
  readonly sameCurrency?: boolean;
}

/** La actividad de `exportacion.actividad` en la config: va si no se escribio otra. */
export interface ExportInputEnv {
  readonly configuredActivity?: number;
}

/**
 * La entrada de `arcli fe` con lo que respondio el usuario: de ella salen el comando equivalente y, con
 * `ExportService.resolve`, la solicitud a ARCA.
 */
export function buildExportInput(state: ExportFlowState, env: ExportInputEnv): ExportVoucherInput {
  return {
    ...state.options,
    activity: state.activity ?? env.configuredActivity,
    amount: state.amount,
    clientAddress: state.clientAddress,
    clientName: state.clientName,
    clientTaxId: state.clientTaxId,
    currencyCode: state.currencyCode,
    description: state.description,
    destinationCountry: state.destinationCountry,
    emit: false,
    exchangeRate: state.exchangeRate,
    exportType: state.exportType,
    incoterm: state.incoterm,
    paymentDate: state.paymentDate,
    paymentTerms: state.paymentTerms,
    permits: state.permits,
    permitsExisting: state.permits ? true : undefined,
    sameCurrency: state.sameCurrency,
  };
}

/** Lo que las reglas de la E toman de la sesion: la actividad de la config y hoy (yyyymmdd). */
export type ExportRuleEnv = ExportInputEnv & { readonly today: string };

/** Las reglas de la E desde una pregunta de la factura: la entrada con lo respondido y hoy. */
export function exportRuleScope(state: ExportFlowState, env: ExportRuleEnv): ExportRuleScope {
  return {
    context: { today: env.today },
    draft: (patch) => ({ ...buildExportInput(state, env), ...patch }),
  };
}

/** `finalize` de la factura E: las reglas sobre la entrada final; si una falla, vuelve a la pregunta dueña. */
export function exportFinalize(env: () => ExportRuleEnv): WizardFinalize<ExportFlowState> {
  return rulesFinalize<ExportFlowState, ExportVoucherInput, ExportRuleContext>({
    context: () => ({ today: env().today }),
    draft: (state) => buildExportInput(state, env()),
    rules: EXPORT_RULES,
  });
}
