import type { ExportCountry, ExportType, ExportVoucherInput } from '../export/export.types';

import type { ExportOptions } from './export-optionals';

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
    exportType: state.exportType,
    incoterm: state.incoterm,
    paymentDate: state.paymentDate,
    paymentTerms: state.paymentTerms,
    permits: state.permits,
    permitsExisting: state.permits ? true : undefined,
    sameCurrency: state.sameCurrency,
  };
}
