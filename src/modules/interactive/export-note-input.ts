import { applyExportAssociatedDefaults, exportAssociatedRuleContext } from '../export/export.notes';
import { EXPORT_RULES, type ExportRuleContext } from '../export/export.rules';
import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_DEBIT_NOTE_KIND,
  EXPORT_VOUCHER_KIND,
  type ExportIssuedVoucher,
  type ExportVoucherInput,
  type ExportVoucherKind,
} from '../export/export.types';

import type { ExportOptions, ExportRuleScope } from './export-optionals';
import { rulesFinalize } from './rule-validator';
import { requireStepValue, type WizardFinalize } from './wizard';

/** Lo que responde quien emite una nota de credito o debito E. */
export interface ExportNoteState {
  readonly amount?: number;
  /** Que ajusta la nota, elegido en el selector de comprobantes: la factura E u otra nota E (`--ac nde` o `--ac nce`). */
  readonly associatedKind?: ExportVoucherKind;
  readonly description?: string;
  /** La cotizacion escrita a mano; sin ella, la del asociado, como el CLI sin `--cm`. */
  readonly exchangeRate?: number;
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
    exchangeRate: state.exchangeRate,
    permits: state.permits,
    voucherKind: env.kind === 'credito' ? EXPORT_CREDIT_NOTE_KIND : EXPORT_DEBIT_NOTE_KIND,
  };
}

/**
 * La nota como la ve `ExportService`: con lo respondido y, lo que no se pregunta (tipo de exportacion, moneda,
 * cotizacion), del asociado. Sin eso la ventana de la fecha seria la de servicios en una nota de bienes.
 */
export function exportNoteRuleInput(state: ExportNoteState, env: ExportNoteInputEnv): ExportVoucherInput {
  return applyExportAssociatedDefaults(buildExportNoteInput(state, env), requireStepValue(state.invoice, 'invoice'));
}

/** Las reglas de la E desde una pregunta de la nota: la nota con lo respondido, y la fecha de su asociado. */
export function exportNoteRuleScope(
  state: ExportNoteState,
  env: ExportNoteInputEnv & { readonly today: string },
): ExportRuleScope {
  return {
    context: {
      associated: exportAssociatedRuleContext(requireStepValue(state.invoice, 'invoice')),
      today: env.today,
    },
    draft: (patch) => ({ ...exportNoteRuleInput(state, env), ...patch }),
  };
}

/** `finalize` de la nota E: las reglas sobre la nota final; sin asociado todavia, no hay entrada. */
export function exportNoteFinalize(
  env: () => ExportNoteInputEnv & { readonly today: string },
): WizardFinalize<ExportNoteState> {
  return rulesFinalize<ExportNoteState, ExportVoucherInput, ExportRuleContext>({
    context: (state) => exportNoteRuleScope(state, env()).context,
    draft: (state) => (state.invoice ? exportNoteRuleInput(state, env()) : undefined),
    rules: EXPORT_RULES,
  });
}
