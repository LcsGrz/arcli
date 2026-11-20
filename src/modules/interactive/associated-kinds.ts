import type { VoucherKindDefinition } from '../billing/billing.types';
import { EXPORT_CREDIT_NOTE_KIND, EXPORT_DEBIT_NOTE_KIND, type ExportVoucherKind } from '../export/export.types';

import {
  associableNoteChoices,
  exportInvoiceChoice,
  exportNoteChoices,
  type InteractiveChoice,
  invoiceKindChoices,
  reciboChoices,
} from './choices';
import type { NewOption } from './new-options';

export type AssociatedKind = ExportVoucherKind | VoucherKindDefinition;

/** Las familias del selector "¿Sobre qué comprobante?" de una nota. */
export type AssociatedFamily = 'factura' | 'nota-credito' | 'nota-debito' | 'recibo';

interface AssociatedKindOption extends InteractiveChoice<AssociatedKind> {
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

const CREDIT_NOTE_FAMILIES: ReadonlySet<VoucherKindDefinition['family']> = new Set([
  'nota-credito',
  'nota-credito-electronica',
]);

/**
 * Las notas de `side` (credito o debito) que puede ajustar una nota de `kind`: de C a A, despues las FCE de C a A y
 * al final la de exportacion E.
 */
function noteOptions(
  kind: 'credito' | 'debito',
  side: 'credito' | 'debito',
  invoices: ReadonlyArray<InteractiveChoice<VoucherKindDefinition>>,
): AssociatedKindOption[] {
  const notes = invoices
    .flatMap((invoice) => associableNoteChoices(kind, invoice.value))
    .filter((note) => CREDIT_NOTE_FAMILIES.has(note.value.family) === (side === 'credito'));
  const exportNote = side === 'credito' ? EXPORT_CREDIT_NOTE_KIND : EXPORT_DEBIT_NOTE_KIND;

  return [...notes, ...exportNoteChoices().filter((note) => note.value === exportNote)].map((note) => ({
    ...note,
    newOption: 'notas-sobre-notas',
  }));
}

/**
 * Lo que puede ajustar una nota de `kind`, en dos niveles: primero el tipo de documento y despues el comprobante.
 * Adentro, las letras van de C a A, despues las FCE y al final la E. Solo quedan las familias con alguna opcion.
 */
export function associatedKindGroups(kind: 'credito' | 'debito'): AssociatedKindGroup[] {
  const invoices = invoiceKindChoices();
  const groups: AssociatedKindGroup[] = [
    {
      description: 'A, B o C, de crédito electrónica (FCE) o de exportación E',
      family: 'factura',
      name: 'Facturas',
      options: [...invoices, { ...exportInvoiceChoice(), newOption: 'notas-e' }],
      question: '¿Qué factura?',
    },
    {
      description: 'Para ajustar una nota de crédito ya emitida',
      family: 'nota-credito',
      name: 'Notas de crédito',
      options: noteOptions(kind, 'credito', invoices),
      question: '¿Qué nota de crédito?',
    },
    {
      description: 'Para ajustar una nota de débito ya emitida',
      family: 'nota-debito',
      name: 'Notas de débito',
      options: noteOptions(kind, 'debito', invoices),
      question: '¿Qué nota de débito?',
    },
    {
      description: 'Recibo A, B o C por un cobro',
      family: 'recibo',
      name: 'Recibos',
      options: reciboChoices().map((recibo) => ({
        ...recibo,
        newOption: recibo.value.letter === 'c' ? 'recibo' : 'recibos-a-b',
      })),
      question: '¿Qué recibo?',
    },
  ];

  return groups.filter((group) => group.options.length > 0);
}

/** Las opciones nuevas de una familia: la familia lleva la marca mientras tenga alguna, como un submenu. */
export function groupNewOptions(group: AssociatedKindGroup): NewOption[] {
  return [...new Set(group.options.flatMap((option) => (option.newOption ? [option.newOption] : [])))];
}
