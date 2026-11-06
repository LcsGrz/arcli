import { conceptCode, documentTypeCode, ivaConditionCode } from './arca-codes';
import { DEFAULT_CURRENCY_CODE } from './billing.constants';
import type { BillingConcept, BillingDocumentType, BillingIvaCondition } from './billing.schemas';
import type { VoucherKindDefinition } from './billing.types';
import { toArcaCurrencyCode } from './currency-codes';

export function resolveBillingConceptCode(concept: BillingConcept): number {
  return conceptCode(concept);
}

export function resolveBillingDocumentTypeCode(documentType: BillingDocumentType): number {
  return documentTypeCode(documentType);
}

export function resolveBillingIvaConditionCode(ivaCondition: BillingIvaCondition): number {
  return ivaConditionCode(ivaCondition);
}

/** Acepta el codigo ISO (`ARS`, `USD`, `UYU`) o el de ARCA (`PES`, `DOL`, `011`) y devuelve el de ARCA. */
export function resolveBillingCurrencyCode(currencyCode = DEFAULT_CURRENCY_CODE): string {
  return toArcaCurrencyCode(currencyCode);
}

/** Tambien la factura E, que no es un VoucherKindDefinition. */
type NamedVoucher = Pick<VoucherKindDefinition, 'family'> & { readonly displayName: string };

function isMasculineVoucher(voucherKind: NamedVoucher): boolean {
  return voucherKind.family === 'recibo';
}

/** Para usar dentro de una frase: `factura B`, `recibo C`. La letra del comprobante siempre va en mayuscula. */
export function formatVoucherLabel(voucherKind: NamedVoucher): string {
  const { displayName } = voucherKind;

  return `${displayName.charAt(0).toLowerCase()}${displayName.slice(1)}`;
}

/** `la factura B`, `el recibo C`. */
export function formatVoucherWithArticle(voucherKind: NamedVoucher): string {
  return `${isMasculineVoucher(voucherKind) ? 'el' : 'la'} ${formatVoucherLabel(voucherKind)}`;
}

/** Para empezar una frase: `La factura B`, `El recibo C`. */
export function formatVoucherSubject(voucherKind: NamedVoucher): string {
  return `${isMasculineVoucher(voucherKind) ? 'El' : 'La'} ${formatVoucherLabel(voucherKind)}`;
}

/** `facturas de crédito electrónica A`, `notas de crédito B`, `recibos C`: el plural va en la primera palabra. */
function formatVoucherPlural(voucherKind: NamedVoucher): string {
  return formatVoucherLabel(voucherKind).replace(/^\p{L}+/u, '$&s');
}

/** `Últimas facturas B`, `Últimos recibos C`. */
export function formatLatestVouchersTitle(voucherKind: NamedVoucher): string {
  return `${isMasculineVoucher(voucherKind) ? 'Últimos' : 'Últimas'} ${formatVoucherPlural(voucherKind)}`;
}

/** `No hay facturas B emitidas`, `No hay recibos C emitidos`. */
export function formatNoVouchersEmitted(voucherKind: NamedVoucher): string {
  return `No hay ${formatVoucherPlural(voucherKind)} ${isMasculineVoucher(voucherKind) ? 'emitidos' : 'emitidas'}`;
}

export const NOTHING_EMITTED_NOTICE = 'No se emitió nada.';

/** La pregunta antes de emitir, igual con flags y en el modo interactivo: siempre dice en que entorno se emite. */
export function formatEmissionQuestion(subject: string, environment: 'produccion' | 'testing'): string {
  return `¿Emitimos ${subject} en ${environment === 'produccion' ? 'PRODUCCIÓN' : 'testing'}?`;
}

export function formatDocumentFlag(documentType: BillingDocumentType): string {
  switch (documentType) {
    case 'cuit':
      return '--cuit';
    case 'cuil':
      return '--cuil';
    case 'dni':
      return '--dni';
    default:
      return '--consumidor-final';
  }
}
