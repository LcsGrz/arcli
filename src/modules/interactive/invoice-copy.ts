import { joinWithAnd } from '../../lib/text/join-with-and';
import { conceptFromCode } from '../billing/arca-codes';
import type {
  BillingConcept,
  BillingDocumentType,
  BillingIvaCondition,
  BillingIvaRate,
} from '../billing/billing.schemas';
import type { VoucherKindDefinition } from '../billing/billing.types';
import { ARCA_LOCAL_CURRENCY_CODE } from '../billing/currency-codes';
import { discriminatesIva } from '../billing/voucher-kind-map';
import { formatVoucherSubject } from '../billing/voucher-names';
import { inferIvaRate, type IssuedVoucher, resolveDocumentType } from '../vouchers/voucher-history';
import { formatReceiver } from '../vouchers/voucher-history.presenter';

import { receiverChoices } from './choices';

/** Lo que se puede copiar de una factura emitida para repetirla o para una nota sobre ella. */
export interface InvoiceCopy {
  /** Codigo ARCA (`PES`, `DOL`…). Una nota va en la moneda de su factura. */
  readonly currencyCode: string;
  readonly exchangeRate?: number;
  readonly exemptAmount?: number;
  readonly ivaRate?: BillingIvaRate;
  /** Por que no se puede reproducir el total exacto; sin motivo, se puede. */
  readonly limitation?: string;
  readonly untaxedAmount?: number;
}

/**
 * ARCA devuelve los totales de la factura, no el detalle por alicuota: con varias alicuotas (o tributos, que ARCLI
 * no maneja) no se puede armar otra igual. En ese caso se devuelve el motivo para avisar y no ofrecer el total.
 */
export function copyInvoiceAmounts(invoice: IssuedVoucher, letter: VoucherKindDefinition['letter']): InvoiceCopy {
  const currencyCode = invoice.currency ?? ARCA_LOCAL_CURRENCY_CODE;
  const foreign = currencyCode !== ARCA_LOCAL_CURRENCY_CODE;
  const withIva = discriminatesIva(letter);
  const ivaRate = withIva ? inferIvaRate(invoice.netAmount, invoice.ivaAmount) : undefined;
  const limitation =
    (invoice.taxesAmount ?? 0) > 0
      ? 'El comprobante tiene tributos o percepciones, que ARCLI no maneja.'
      : withIva && invoice.netAmount > 0 && !ivaRate
        ? 'No se pudo deducir la alícuota de la factura: tiene varias o una que no es estandar.'
        : undefined;

  return {
    currencyCode,
    exchangeRate: foreign ? invoice.exchangeRate : undefined,
    exemptAmount: withIva ? invoice.exemptAmount || undefined : undefined,
    ivaRate,
    limitation,
    untaxedAmount: withIva ? invoice.untaxedAmount || undefined : undefined,
  };
}

/** Lo que se copia de una factura emitida ademas de los importes: el receptor y el concepto. */
export interface InvoiceReceiverCopy {
  readonly concept: BillingConcept;
  /** Sin numero en consumidor final. */
  readonly documentNumber: number | undefined;
  readonly documentType: BillingDocumentType;
  /** Consumidor final ya la define; si no, ARCA no la devuelve y hay que preguntarla. */
  readonly ivaCondition: BillingIvaCondition | undefined;
}

/** El aviso cuando el comprobante tiene un tipo de documento que `copyInvoiceReceiver` no reconoce. */
export const UNSUPPORTED_DOCUMENT_TYPE_NOTICE =
  'El comprobante tiene un tipo de documento que el asistente no soporta. Usá los flags del CLI.';

/**
 * El receptor y el concepto de una factura emitida, para repetirla o para una nota sobre ella. Un concepto que ARCA
 * no informa o que no se reconoce queda en servicios. `undefined` si el tipo de documento no es uno que maneja ARCLI.
 */
export function copyInvoiceReceiver(invoice: IssuedVoucher): InvoiceReceiverCopy | undefined {
  const documentType = resolveDocumentType(invoice.documentTypeCode);

  if (!documentType) {
    return undefined;
  }

  const consumer = documentType === 'consumidor-final';

  return {
    concept: conceptFromCode(invoice.concept) ?? 'servicios',
    documentNumber: consumer ? undefined : invoice.documentNumber,
    documentType,
    ivaCondition: consumer ? 'consumidor-final' : undefined,
  };
}

const COPIED_DOCUMENT_LABELS: Record<BillingDocumentType, string> = {
  'consumidor-final': 'a consumidor final',
  cuil: 'a un CUIL',
  cuit: 'a un CUIT',
  dni: 'a un DNI',
};

/**
 * Al repetir un comprobante, el aviso si su receptor ya no se admite en ese tipo: la A y la FCE solo van a un CUIT
 * (10013, 10015). Una A vieja a un DNI llegaba a la vista previa y recien ahi se rechazaba. `undefined` si se admite.
 */
export function copiedReceiverNotice(
  receiver: Pick<InvoiceReceiverCopy, 'documentType'>,
  voucherKind: VoucherKindDefinition,
): string | undefined {
  const allowed = receiverChoices(voucherKind.letter, voucherKind.isElectronicCredit).some(
    (choice) => choice.value === receiver.documentType,
  );

  return allowed
    ? undefined
    : `${formatVoucherSubject(voucherKind)} original fue ${COPIED_DOCUMENT_LABELS[receiver.documentType]}, pero ARCA solo admite un CUIT como receptor (error ${voucherKind.isElectronicCredit ? 10015 : 10013}). Ingresá el CUIT del receptor.`;
}

/**
 * Lo que "Repetir" copia de una A, B, C, FCE o recibo, dicho al elegirlo, como en la E. El receptor que la letra no
 * admite no va (se pide el CUIT) y el monto tampoco si no se puede reproducir.
 */
export function copiedInvoiceNotice(invoice: IssuedVoucher, voucherKind: VoucherKindDefinition): string {
  const receiver = copyInvoiceReceiver(invoice);
  const { currencyCode, ivaRate, limitation } = copyInvoiceAmounts(invoice, voucherKind.letter);
  const copiesReceiver = receiver && copiedReceiverNotice(receiver, voucherKind) === undefined;
  const label = receiver?.documentType === 'consumidor-final' ? 'consumidor final' : formatReceiver(invoice);
  const copied = [
    ...(copiesReceiver ? [`el receptor (${label})`] : []),
    'el concepto',
    'la moneda',
    ...(limitation ? [] : ['el monto']),
    ...(ivaRate ? ['la alícuota'] : []),
  ];
  const renewed = currencyCode === ARCA_LOCAL_CURRENCY_CODE ? 'Las fechas' : 'Las fechas y la cotización';

  return `Se copian ${joinWithAnd(copied)}. ${renewed} son nuevas.`;
}

/**
 * "Repetir" con otro monto (escrito, no el del original): el exento y el no gravado del original no se copian en valores
 * absolutos; si tenia, se vuelven a preguntar con el opcional marcado (REV-70).
 */
export function asksCopiedExempt(state: {
  readonly original?: IssuedVoucher;
  readonly sameAmount?: boolean;
  readonly voucherKind?: VoucherKindDefinition;
}): boolean {
  if (state.sameAmount === true || !state.original || !state.voucherKind) {
    return false;
  }

  const copy = copyInvoiceAmounts(state.original, state.voucherKind.letter);

  return Boolean(copy.exemptAmount || copy.untaxedAmount);
}
