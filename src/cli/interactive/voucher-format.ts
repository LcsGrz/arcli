import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { formatMoneyLabel } from '../../modules/billing/billing.labels';
import type { IssuedVoucher } from '../../modules/interactive/voucher-history';

export function formatVoucherNumber(pointOfSale: number, number: number): string {
  return `${String(pointOfSale).padStart(5, '0')}-${String(number).padStart(8, '0')}`;
}

export function formatReceiver(voucher: IssuedVoucher): string {
  switch (voucher.documentTypeCode) {
    case 80:
      return `CUIT ${voucher.documentNumber}`;
    case 86:
      return `CUIL ${voucher.documentNumber}`;
    case 96:
      return `DNI ${voucher.documentNumber}`;
    case 99:
      return 'Consumidor final';
    default:
      return `Doc ${voucher.documentTypeCode} ${voucher.documentNumber}`;
  }
}

export function formatVoucherSummary(pointOfSale: number, voucher: IssuedVoucher): string {
  return [
    `N° ${formatVoucherNumber(pointOfSale, voucher.number)}`,
    formatArcaDateAsArgentineDate(voucher.date),
    formatReceiver(voucher).padEnd(20),
    formatMoneyLabel(voucher.total),
  ].join('  ·  ');
}
