import type { VoucherKindDefinition } from '../billing/billing.types';
import type { ExportVoucherKind } from '../export/export.types';

import {
  associableNoteChoices,
  exportInvoiceChoice,
  exportNoteChoices,
  type InteractiveChoice,
  INVOICE_DESCRIPTIONS,
  invoiceKindChoices,
  reciboChoice,
} from './choices';
import type { NewOption } from './new-options';

export type AssociatedKind = ExportVoucherKind | VoucherKindDefinition;

/** Las familias del selector "¿Sobre qué comprobante?" de una nota. */
export type AssociatedFamily = 'exportacion' | 'factura' | 'fce' | 'nota' | 'recibo';

export interface AssociatedKindOption extends InteractiveChoice<AssociatedKind> {
  /** Para la marca "(nuevo)": la opcion que la trajo. */
  readonly newOption?: NewOption;
}

export interface AssociatedKindGroup {
  readonly description: string;
  readonly family: AssociatedFamily;
  readonly name: string;
  /** La pregunta del segundo nivel; con una sola opcion no se hace. */
  readonly question: string;
  readonly options: readonly AssociatedKindOption[];
}

function associableNotes(
  kind: 'credito' | 'debito',
  invoices: ReadonlyArray<InteractiveChoice<VoucherKindDefinition>>,
) {
  return invoices.flatMap((invoice) =>
    associableNoteChoices(kind, invoice.value).map((note) => ({ ...note, newOption: 'notas-sobre-notas' as const })),
  );
}

/**
 * Lo que puede ajustar una nota de `kind`, en dos niveles: primero la familia y despues el comprobante. Las letras van
 * de C a A, como en el selector de facturas. En FCE, cada factura va seguida de la nota que permite la anulacion.
 */
export function associatedKindGroups(kind: 'credito' | 'debito'): AssociatedKindGroup[] {
  const invoices = invoiceKindChoices();
  const recibo = reciboChoice();
  const common = invoices.filter((choice) => !choice.value.isElectronicCredit);
  const fce = invoices
    .filter((choice) => choice.value.isElectronicCredit)
    .map((choice) => ({ ...choice, description: INVOICE_DESCRIPTIONS[choice.value.letter] }));

  return [
    {
      description: 'Factura A, B o C ya emitida',
      family: 'factura',
      name: 'Factura',
      options: common,
      question: '¿Qué factura?',
    },
    {
      description: 'Para ajustar una nota A, B o C ya emitida',
      family: 'nota',
      name: 'Otra nota de crédito o débito',
      options: associableNotes(kind, common),
      question: '¿Qué nota?',
    },
    {
      description: recibo.description ?? '',
      family: 'recibo',
      name: recibo.name,
      options: [{ ...recibo, newOption: 'recibo' }],
      question: '¿Qué recibo?',
    },
    {
      description: 'MiPyMEs, para grandes empresas: la factura o sus notas',
      family: 'fce',
      name: 'Factura de crédito electrónica (FCE)',
      options: fce.flatMap((invoice) => [invoice, ...associableNotes(kind, [invoice])]),
      question: '¿Qué comprobante FCE?',
    },
    {
      description: 'A un cliente del exterior: la factura o sus notas',
      family: 'exportacion',
      name: 'Exportación (E)',
      options: [
        { ...exportInvoiceChoice(), newOption: 'notas-e' },
        ...exportNoteChoices().map((note) => ({ ...note, newOption: 'notas-sobre-notas' as const })),
      ],
      question: '¿Qué comprobante de exportación?',
    },
  ];
}

/** Las opciones nuevas de una familia: la familia lleva la marca mientras tenga alguna, como un submenu. */
export function groupNewOptions(group: AssociatedKindGroup): NewOption[] {
  return [...new Set(group.options.flatMap((option) => (option.newOption ? [option.newOption] : [])))];
}
