import type { VoucherKindDefinition } from '../billing/billing.types';

/** `factura-c_0003-00000125.pdf`: se lee facil, se ordena bien y no se repite. */
export function buildPdfFileName(voucherKind: VoucherKindDefinition, pointOfSale: number, number: number): string {
  const pv = String(pointOfSale).padStart(4, '0');
  const voucherNumber = String(number).padStart(8, '0');

  return `${voucherKind.family}-${voucherKind.letter}_${pv}-${voucherNumber}.pdf`;
}
