import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import { isFceInvoice, isNote, VOUCHER_KIND_MAP } from '../../modules/billing/voucher-kind-map';

/** Los flags de un comprobante válido de cada tipo, a partir del mapa: uno nuevo entra solo o hace fallar el test. */
export function argsForKind(kind: VoucherKindDefinition, clientCuit: number): string[] {
  const { isElectronicCredit, letter, shortcut } = kind;
  const receiver =
    !isElectronicCredit && letter !== 'a'
      ? ['--cfinal']
      : ['--cuit', String(clientCuit), letter === 'b' ? '--ir-se' : '--ir-ri'];
  const invoice = Object.values(VOUCHER_KIND_MAP).find(
    (other) => other.letter === letter && (isElectronicCredit ? isFceInvoice(other) : other.family === 'factura'),
  );

  return [
    ...[shortcut, '-m', '1000000', '--cs', ...receiver],
    ...(isNote(kind) ? ['--ac', String(invoice?.shortcut), '--apv', '3', '--ar', '12'] : []),
    ...(isFceInvoice(kind) ? ['--cbu', '0110599520000012345678'] : []),
  ];
}
