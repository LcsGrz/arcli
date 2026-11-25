import type { Rule } from '../../lib/rules/rules';

import type { ExportVoucherInput } from './export.types';

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
