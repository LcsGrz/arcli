import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_DEBIT_NOTE_KIND,
  EXPORT_VOUCHER_KIND,
  type ExportIssuedVoucher,
  type ExportVoucherInput,
  type ExportVoucherKind,
} from '../export/export.types';

import type { ExportOptions } from './export-optionals';
import { requireStepValue } from './wizard';

/** Lo que responde quien emite una nota de credito o debito E. */
export interface ExportNoteState {
  readonly amount?: number;
  /** Que ajusta la nota, elegido en el selector de comprobantes: la factura E u otra nota E (`--ac nde` o `--ac nce`). */
  readonly associatedKind?: ExportVoucherKind;
  readonly description?: string;
  readonly invoice?: ExportIssuedVoucher;
  readonly invoicePointOfSale?: number;
  readonly options?: ExportOptions;
  readonly permits?: readonly string[];
}

/** Credito o debito: viene del menu principal. */
export interface ExportNoteInputEnv {
  readonly kind: 'credito' | 'debito';
}

/**
 * La entrada de `arcli nce` o `arcli nde` con lo que respondio el usuario: de ella salen el comando equivalente y la
 * solicitud a ARCA. La actividad no va: la nota la toma del asociado.
 */
export function buildExportNoteInput(state: ExportNoteState, env: ExportNoteInputEnv): ExportVoucherInput {
  const invoice = requireStepValue(state.invoice, 'invoice');
  const associatedKind = state.associatedKind ?? EXPORT_VOUCHER_KIND;

  return {
    ...state.options,
    amount: state.amount,
    associatedVoucher: {
      number: invoice.number,
      pointOfSale: invoice.pointOfSale,
      shortcut: associatedKind === EXPORT_VOUCHER_KIND ? undefined : associatedKind.shortcut,
    },
    description: state.description,
    emit: false,
    permits: state.permits,
    voucherKind: env.kind === 'credito' ? EXPORT_CREDIT_NOTE_KIND : EXPORT_DEBIT_NOTE_KIND,
  };
}
