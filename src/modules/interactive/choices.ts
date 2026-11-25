import { ivaConditionCode } from '../billing/arca-codes';
import { listAssociableFamilies } from '../billing/billing.associated-vouchers';
import { listAllowedIvaConditions } from '../billing/billing.iva-receptor';
import { formatIvaConditionLabel } from '../billing/billing.labels';
import type {
  BillingConcept,
  BillingDocumentType,
  BillingIvaCondition,
  BillingIvaRate,
} from '../billing/billing.schemas';
import type { VoucherKindDefinition, VoucherLetter, VoucherShortcut } from '../billing/billing.types';
import { ARCA_CURRENCIES, ARCA_LOCAL_CURRENCY_CODE, toArcaCurrencyCode } from '../billing/currency-codes';
import {
  getVoucherKindByFamilyAndLetter,
  isNote,
  VOUCHER_FAMILIES,
  VOUCHER_KIND_MAP,
} from '../billing/voucher-kind-map';
import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_DEBIT_NOTE_KIND,
  EXPORT_VOUCHER_KIND,
  type ExportVoucherKind,
} from '../export/export.kinds';
import { DEFAULT_EXPORT_CURRENCY_CODE } from '../export/export.types';

export interface InteractiveChoice<T> {
  readonly description?: string;
  /** Lo que tambien encuentra la opcion al escribir en la lista, ademas del nombre (por ejemplo, `DOL` o `060`). */
  readonly keywords?: string;
  readonly name: string;
  readonly value: T;
}

/**
 * La primera de `candidates` que esta entre las opciones, para la que arranca marcada: una respuesta recordada puede ya
 * no estar (otra letra, otra lista) y entonces vale la siguiente, por ejemplo la de la config. Sin ninguna, `undefined`
 * (la lista arranca en la primera opcion).
 */
export function availableChoice<T>(
  choices: ReadonlyArray<{ readonly value: T }>,
  ...candidates: ReadonlyArray<T | undefined>
): T | undefined {
  return candidates.find(
    (candidate) => candidate !== undefined && choices.some((choice) => choice.value === candidate),
  );
}

const INVOICE_DESCRIPTIONS: Record<VoucherLetter, string> = {
  a: 'Entre responsables inscriptos, o de RI a monotributista',
  b: 'De responsable inscripto a consumidor final, exento u otros',
  c: 'La emiten monotributistas y exentos',
};

const INVOICE_SHORTCUTS: readonly VoucherShortcut[] = ['fc', 'fb', 'fa', 'fcec', 'fceb', 'fcea'];

export function invoiceKindChoices(): Array<InteractiveChoice<VoucherKindDefinition>> {
  return INVOICE_SHORTCUTS.map((shortcut) => {
    const definition = VOUCHER_KIND_MAP[shortcut];
    const description = definition.isElectronicCredit
      ? 'Factura de Crédito Electrónica MiPyMEs, para grandes empresas'
      : INVOICE_DESCRIPTIONS[definition.letter];

    return { description, name: definition.displayName, value: definition };
  });
}

const RECEIPT_DESCRIPTIONS: Record<VoucherLetter, string> = {
  a: 'Por un cobro a un responsable inscripto o monotributista',
  b: 'Por un cobro a un consumidor final, exento u otros',
  c: 'Por un cobro; lo emiten monotributistas y exentos',
};

const RECEIPT_SHORTCUTS: readonly VoucherShortcut[] = ['rc', 'rb', 'ra'];

/** Los recibos, de C a A como las facturas: se emiten como una factura de la misma letra. */
export function reciboChoices(): Array<InteractiveChoice<VoucherKindDefinition>> {
  return RECEIPT_SHORTCUTS.map((shortcut) => {
    const definition = VOUCHER_KIND_MAP[shortcut];

    return { description: RECEIPT_DESCRIPTIONS[definition.letter], name: definition.displayName, value: definition };
  });
}

/** La factura E va por WSFEX y tiene su propio asistente, pero se elige en el mismo selector que A, B y C. */
export function exportInvoiceChoice(): InteractiveChoice<ExportVoucherKind> {
  return {
    description: 'A un cliente del exterior: servicios o bienes',
    name: EXPORT_VOUCHER_KIND.displayName,
    value: EXPORT_VOUCHER_KIND,
  };
}

/** Las notas E que ajusta otra nota E: el CLI las pide con `--ac nce` y `--ac nde`. */
export function exportNoteChoices(): Array<InteractiveChoice<ExportVoucherKind>> {
  return [EXPORT_CREDIT_NOTE_KIND, EXPORT_DEBIT_NOTE_KIND].map((kind) => ({
    description: 'Para ajustar una nota E ya emitida',
    name: kind.displayName,
    value: kind,
  }));
}

/**
 * Las notas que puede ajustar una nota de `kind` de la misma letra y categoria que `invoice`: en A, B y C las dos;
 * en FCE solo la que permite la anulacion (una NC FCE ajusta una ND FCE, y una ND FCE una NC FCE).
 */
export function associableNoteChoices(
  kind: 'credito' | 'debito',
  invoice: VoucherKindDefinition,
): Array<InteractiveChoice<VoucherKindDefinition>> {
  const noteFamily = noteKindChoices(kind, invoice).family;
  const families = new Set([...listAssociableFamilies(noteFamily, false), ...listAssociableFamilies(noteFamily, true)]);

  // En el orden del mapa: NC, ND, NC FCE y ND FCE.
  return VOUCHER_FAMILIES.filter((family) => isNote({ family }) && families.has(family)).flatMap((family) => {
    const definition = getVoucherKindByFamilyAndLetter(family, invoice.letter);

    if (!definition) {
      return [];
    }

    const description = definition.isElectronicCredit
      ? 'Solo en una nota de anulación'
      : 'Para ajustar una nota ya emitida';

    return [{ description, name: definition.displayName, value: definition }];
  });
}

export function noteKindChoices(kind: 'credito' | 'debito', invoice: VoucherKindDefinition): VoucherKindDefinition {
  const prefix = kind === 'credito' ? 'nc' : 'nd';
  const shortcut = `${prefix}${invoice.isElectronicCredit ? 'e' : ''}${invoice.letter}` as VoucherShortcut;

  return VOUCHER_KIND_MAP[shortcut];
}

/**
 * A quien puede ir el comprobante: la A solo a un CUIT (10013; consumidor final tampoco, 10243) y la FCE, en
 * cualquier letra, tambien solo a un CUIT (10015, WSFEv1 v4.7).
 */
export function receiverChoices(
  letter: VoucherLetter,
  electronicCredit = false,
): Array<InteractiveChoice<BillingDocumentType>> {
  if (electronicCredit) {
    return [{ name: 'Con CUIT', value: 'cuit' }];
  }

  const choices: Array<InteractiveChoice<BillingDocumentType>> = [];

  if (listAllowedIvaConditions(letter).includes('consumidor-final')) {
    // Sin identificar o, desde el tope de la RG 5700/2025 (o en los opcionales), con su documento.
    choices.push({ name: 'Consumidor final', value: 'consumidor-final' });
  }

  choices.push({ name: 'Con CUIT', value: 'cuit' });

  if (letter !== 'a') {
    choices.push({ name: 'Con DNI', value: 'dni' }, { name: 'Con CUIL', value: 'cuil' });
  }

  return choices;
}

export function ivaConditionChoices(letter: VoucherLetter): Array<InteractiveChoice<BillingIvaCondition>> {
  return listAllowedIvaConditions(letter).map((condition) => ({
    name: formatIvaConditionLabel(ivaConditionCode(condition)),
    value: condition,
  }));
}

export function conceptChoices(): Array<InteractiveChoice<BillingConcept>> {
  return [
    { name: 'Servicios', value: 'servicios' },
    { name: 'Productos', value: 'productos' },
    { name: 'Productos y servicios', value: 'productos-servicios' },
  ];
}

export function ivaRateChoices(): Array<InteractiveChoice<BillingIvaRate>> {
  return (['21', '10.5', '27', '5', '2.5', '0'] as const).map((rate) => ({
    name: `${rate.replace('.', ',')}%`,
    value: rate,
  }));
}

/**
 * Monedas del comprobante: pesos y despues las de la tabla de ARCA con codigo ISO, en su orden (dolares y euros
 * primero). Las que ARCA publica solo con un codigo numerico (`002`, oro) quedan para el CLI.
 */
export function currencyChoices(): Array<InteractiveChoice<string>> {
  return ARCA_CURRENCIES.flatMap((currency) => {
    const code = currency.iso ?? (/^[A-Z]{3}$/.test(currency.arca) ? currency.arca : undefined);

    if (!code) {
      return [];
    }

    // El codigo de ARCA tambien la encuentra al escribir: "dol" o "060", como en "Monedas y cotizaciones".
    const keywords = [currency.arca, code].join(' ');

    return code === 'ARS'
      ? [{ keywords, name: 'Pesos', value: ARCA_LOCAL_CURRENCY_CODE }]
      : [{ keywords, name: `${currency.name} (${code})`, value: code }];
  });
}

/**
 * Monedas de una E: las mismas que ofrecen A, B y C, con los dolares primero y con su codigo de ARCA, que estan en la
 * tabla de WSFEX (`table`). Los pesos van siempre: WSFEX los acepta y no se controlan contra la tabla. Sin la tabla
 * (ARCA no respondio o vino vacia), solo dolares y pesos.
 */
export function exportCurrencyChoices(table: ReadonlyArray<{ readonly code: string }>) {
  const listed = new Set(
    table.length > 0 ? table.map((entry) => entry.code.trim().toUpperCase()) : [DEFAULT_EXPORT_CURRENCY_CODE],
  );
  const choices = currencyChoices()
    .map((choice) => ({ ...choice, value: toArcaCurrencyCode(choice.value) }))
    .filter((choice) => choice.value === ARCA_LOCAL_CURRENCY_CODE || listed.has(choice.value));
  const isDefault = (choice: { readonly value: string }) => choice.value === DEFAULT_EXPORT_CURRENCY_CODE;

  return [...choices.filter(isDefault), ...choices.filter((choice) => !isDefault(choice))];
}
