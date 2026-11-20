import type { ExportCountry, ExportIssuedVoucher, ExportVoucherInput } from '../export/export.types';

import type { ExportInvoiceCopy } from './export-copy';
import type { ExportInputEnv } from './export-input';
import type { ExportOptions } from './export-optionals';
import { requireStepValue } from './wizard';

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
