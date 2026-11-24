import type { VoucherKindDefinition } from './billing.types';
import { isReceipt } from './voucher-kind-map';

/** Tambien la factura E, que no es un VoucherKindDefinition. */
type NamedVoucher = Pick<VoucherKindDefinition, 'family'> & { readonly displayName: string };

/** El recibo es el único masculino: `el recibo C`, `la factura B`. */
function isMasculineVoucher(voucherKind: NamedVoucher): boolean {
  return isReceipt(voucherKind);
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
