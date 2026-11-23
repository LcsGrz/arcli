import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import type { Rule } from '../../lib/rules/rules';

import { EXPORT_ITEMS_TOTAL_RULE } from './export.items';
import {
  earliestExportVoucherDate,
  EXPORT_EXCHANGE_RATE_RULE,
  EXPORT_VOUCHER_DATE_WINDOW_RULE,
  exportTypeTakesPaymentDate,
  resolveExportRuleDate,
} from './export.mappers';
import { EXPORT_NOTE_AFTER_ASSOCIATED_RULE } from './export.notes';
import { DEFAULT_EXPORT_TYPE, EXPORT_VOUCHER_KIND, type ExportVoucherInput, isExportNote } from './export.types';

/**
 * Lo que una regla de la E necesita ademas de la entrada: hoy (yyyymmdd) y, en una nota, la fecha y el nombre del
 * comprobante que ajusta (lo trae ARCA). Las reglas que necesitan uno que falta no corren.
 */
export interface ExportRuleContext {
  readonly associated?: { readonly date: string; readonly label: string };
  readonly today?: string;
  /**
   * La fecha del comprobante todavia no se eligio (en el asistente, "Fecha de pago" se pregunta antes que los
   * opcionales, TUI-22): sin `voucherDate`, la fecha de pago se compara con la mas temprana que acepta ARCA
   * (`earliestExportVoucherDate`), no con hoy, para no rechazar una que valdria con la fecha que se elija despues. La
   * comparacion exacta la hacen "Fecha del comprobante" y `finalize`.
   */
  readonly undecidedVoucherDate?: boolean;
}

export type ExportRule = Rule<ExportVoucherInput, ExportRuleContext>;

/**
 * 1674 (WSFEX v3.1.0): en la factura de servicios y otros, la fecha de pago es igual o posterior a la del comprobante
 * (sin fecha, hoy). En bienes y en las notas no va. Sin `--fecha-pago` va la del comprobante.
 *
 * @internal Exportado para los tests.
 */
export const EXPORT_PAYMENT_DATE_RULE: ExportRule = {
  check: (input, { today, undecidedVoucherDate }) => {
    const kind = input.voucherKind ?? EXPORT_VOUCHER_KIND;
    const typed = input.voucherDate?.trim();

    if (
      !input.paymentDate?.trim() ||
      (!typed && !today) ||
      !exportTypeTakesPaymentDate(input.exportType ?? DEFAULT_EXPORT_TYPE, isExportNote(kind))
    ) {
      return undefined;
    }

    const undecided = !typed && undecidedVoucherDate;
    const voucherDate = typed
      ? resolveExportRuleDate(typed, today)
      : undecided
        ? earliestExportVoucherDate(today as string)
        : (today as string);
    const paymentDate = resolveExportRuleDate(input.paymentDate, today);

    // Una fecha sin año, sin `today`: no se puede comparar.
    if (!paymentDate || !voucherDate || paymentDate >= voucherDate) {
      return undefined;
    }

    const voucherLabel = formatArcaDateAsArgentineDate(voucherDate);

    return {
      message: `La fecha de pago (${formatArcaDateAsArgentineDate(paymentDate)}) no puede ser anterior a la del comprobante (${voucherLabel}): ARCA la rechaza (error 1674). Revisá \`--fecha-pago\`.`,
      question: undecided
        ? `La fecha de pago no puede ser anterior al ${voucherLabel}: es la fecha más temprana que ARCA acepta para el comprobante, y un pago anterior a él lo rechaza (error 1674).`
        : typed
          ? `La fecha de pago no puede ser anterior a la del comprobante (${voucherLabel}): ARCA la rechaza (error 1674).`
          : // En el asistente, sin fecha elegida va la de hoy: la otra salida es elegir una anterior en los opcionales.
            `La fecha de pago no puede ser anterior a la del comprobante (hoy): ARCA la rechaza (error 1674). Escribí una desde el ${voucherLabel}, o volvé y elegí una fecha del comprobante anterior en los opcionales.`,
    };
  },
  fields: ['paymentDate', 'voucherDate'],
  id: 'export-payment-date',
};

/** Las de las fechas de la E, en el orden en que las controla `ExportService.resolve`. */
export const EXPORT_DATE_RULES: readonly ExportRule[] = [EXPORT_VOUCHER_DATE_WINDOW_RULE, EXPORT_PAYMENT_DATE_RULE];

/**
 * Todas las reglas entre campos de la E (factura, notas y "Repetir"): las usa el CLI (`ExportService.resolve` y las
 * funciones que llama, con `assertRules`) y el asistente (`ruleValidator` en cada pregunta que escribe un campo, y
 * `finalize` sobre la entrada final).
 */
export const EXPORT_RULES: readonly ExportRule[] = [
  ...EXPORT_DATE_RULES,
  EXPORT_NOTE_AFTER_ASSOCIATED_RULE,
  EXPORT_ITEMS_TOTAL_RULE,
  EXPORT_EXCHANGE_RATE_RULE,
];
