import { EXPORT_RULES, type ExportRuleContext } from '../export/export.rules';
import type { ExportCountry, ExportItemInput, ExportType, ExportVoucherInput } from '../export/export.types';

import { exportItemsEntry } from './export-items';
import type { ExportOptions, ExportRuleScope } from './export-optionals';
import { rulesFinalize } from './rule-validator';
import type { WizardFinalize } from './wizard';

/** Lo que responde quien emite una factura E con "Emitir factura". */
export interface ExportFlowState {
  readonly activity?: number;
  readonly clientAddress?: string;
  readonly clientName?: string;
  readonly clientTaxId?: string;
  /** El destino como esta en la tabla de ARCA, para el CUIT del pais. */
  readonly country?: ExportCountry;
  /** ARCA no publica un CUIT para el destino: hay que pedirlo (`--cuit-pais`). */
  readonly countryCuitMissing?: boolean;
  /** El codigo de ARCA (`DOL`, `060`, `PES`). */
  readonly currencyCode?: string;
  readonly destinationCountry?: string;
  /** La cotizacion escrita a mano; sin ella, la de aduana de ARCA, como el CLI sin `--cm`. */
  readonly exchangeRate?: number;
  readonly exportType?: ExportType;
  readonly incoterm?: string;
  /** Nombre del incoterm en la tabla de ARCA: la descripcion que va si no se escribe otra. */
  readonly incotermName?: string;
  /** Siempre al menos uno (ARCA lo exige): el total de la factura es su suma (NAV-10). */
  readonly items?: readonly ExportItemInput[];
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
    // El total es la suma de los items (1610 por construccion), en la forma rapida si es un solo renglon (NAV-10).
    ...exportItemsEntry(state.items),
    clientAddress: state.clientAddress,
    clientName: state.clientName,
    clientTaxId: state.clientTaxId,
    currencyCode: state.currencyCode,
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
export function exportRuleScope(state: ExportFlowState, env: () => ExportRuleEnv): ExportRuleScope {
  return {
    context: () => ({ today: env().today }),
    draft: (patch) => ({ ...buildExportInput(state, env()), ...patch }),
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
