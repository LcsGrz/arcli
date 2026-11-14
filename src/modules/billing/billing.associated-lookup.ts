import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { InputValidationError } from '../../lib/errors/app-error';
import type { ResolvedArcaRuntime } from '../../services/arca/arca-context.resolver';
import type { IssuedVoucher, VoucherHistoryGateway } from '../vouchers/voucher-history';
import { formatVoucherNumber } from '../vouchers/voucher-history.presenter';

import { formatMoneyLabel } from './billing.labels';
import { formatVoucherWithArticle } from './billing.mappers';
import type { BillingCommandInput } from './billing.schemas';
import type { BillingService } from './billing.service';
import type { VoucherKindDefinition } from './billing.types';
import { getVoucherKindByArcaType, getVoucherKindByShortcut } from './voucher-kind-map';

const CREDIT_NOTE_FAMILIES: ReadonlySet<VoucherKindDefinition['family']> = new Set([
  'nota-credito',
  'nota-credito-electronica',
]);

/** `la factura A 00003-00000012`, para usar dentro de una frase. */
function describeAssociated(arcaType: number, pointOfSale: number, number: number): string {
  const kind = getVoucherKindByArcaType(arcaType);
  const name = kind ? formatVoucherWithArticle(kind) : `el comprobante tipo ${arcaType}`;

  return `${name} ${formatVoucherNumber(pointOfSale, number)}`;
}

/**
 * El tope de la NC, con el mismo criterio que las notas E: solo si van en la misma moneda, porque en otra moneda los
 * totales no se comparan.
 */
export function assertCreditNoteWithinAssociated(options: {
  readonly associated: Pick<IssuedVoucher, 'currency' | 'total'>;
  readonly associatedLabel: string;
  readonly note: { readonly currencyCode: string; readonly total: number };
}): void {
  const { associated, associatedLabel, note } = options;
  const associatedCurrency = associated.currency?.trim().toUpperCase();

  if (associatedCurrency && associatedCurrency !== note.currencyCode.trim().toUpperCase()) {
    return;
  }

  if (note.total > associated.total) {
    throw new InputValidationError(
      `La nota de crédito (${formatMoneyLabel(note.total, note.currencyCode)}) no puede superar el total de ${associatedLabel} (${formatMoneyLabel(associated.total, associated.currency ?? note.currencyCode)}).`,
    );
  }
}

/**
 * Si hay que consultar el asociado en ARCA antes de emitir la nota: para el tope de una NC y para la fecha de una
 * nota FCE sin `--afecha`. Solo se consultan comprobantes propios; el de otro CUIT no se puede leer.
 */
function shouldLookUpAssociated(
  input: BillingCommandInput,
  voucherKind: VoucherKindDefinition,
  emitterCuit: number,
): boolean {
  const associated = input.associatedVoucher;

  if (!voucherKind.requiresAssociatedVoucher || !associated?.numero || !associated.puntoVenta) {
    return false;
  }

  if (associated.cuit !== undefined && associated.cuit.replace(/\D/g, '') !== String(emitterCuit)) {
    return false;
  }

  const needsDate = voucherKind.isElectronicCredit && !associated.fecha;

  return needsDate || CREDIT_NOTE_FAMILIES.has(voucherKind.family);
}

/**
 * Lo que se controla contra el asociado al emitir una nota A, B, C o FCE, con una sola consulta a ARCA y sin sumar
 * llamadas a la vista previa: que una NC no supere el total del asociado y, en una nota FCE sin `--afecha`, la fecha
 * del asociado. Devuelve la entrada con esa fecha, para que el payload la lleve.
 *
 * Si ARCA no tiene el asociado, la nota FCE sin fecha no se puede armar y frena; en el resto ARCA decide al emitir.
 */
export async function checkAssociatedInArca(options: {
  readonly gateway: Pick<VoucherHistoryGateway, 'getVoucher'>;
  readonly input: BillingCommandInput;
  readonly runtime: ResolvedArcaRuntime;
  readonly service: Pick<BillingService, 'buildVoucherPayload'>;
}): Promise<BillingCommandInput> {
  const { gateway, input, runtime, service } = options;
  const voucherKind = getVoucherKindByShortcut(input.shortcut);
  const associated = input.associatedVoucher;

  if (!voucherKind || !associated || !shouldLookUpAssociated(input, voucherKind, runtime.context.cuit)) {
    return input;
  }

  // Valida la entrada antes de consultar: si la nota no se puede armar, no hace falta ir a ARCA.
  const payload = service.buildVoucherPayload(input, runtime, voucherKind);
  const reference = payload.CbtesAsoc?.[0];

  if (!reference) {
    return input;
  }

  const voucher = await gateway.getVoucher(reference.Nro, reference.PtoVta, reference.Tipo);
  const label = describeAssociated(reference.Tipo, reference.PtoVta, reference.Nro);

  if (!voucher) {
    if (voucherKind.isElectronicCredit && !associated.fecha) {
      throw new InputValidationError(
        `ARCA no tiene ${label}, así que no se puede tomar su fecha. Revisá \`--ac\`, \`--apv\` y \`--ar\`.`,
      );
    }

    return input;
  }

  if (CREDIT_NOTE_FAMILIES.has(voucherKind.family)) {
    assertCreditNoteWithinAssociated({
      associated: voucher,
      associatedLabel: label,
      note: { currencyCode: payload.MonId, total: payload.ImpTotal },
    });
  }

  if (!voucherKind.isElectronicCredit || associated.fecha) {
    return input;
  }

  return { ...input, associatedVoucher: { ...associated, fecha: formatArcaDateAsArgentineDate(voucher.date) } };
}
