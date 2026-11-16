import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { InputValidationError } from '../../lib/errors/app-error';
import { formatArgentineAmountInput } from '../../lib/numbers/argentine-amount';
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

/** El total del asociado para una frase: `la factura C 00003-00000045, de $ 120.000`. */
function describeTotal(associatedLabel: string, total: number, currency: string | undefined): string {
  return `${associatedLabel}, de ${formatMoneyLabel(total, currency)}`;
}

/**
 * El error de una NC que supera a su asociado, igual en A, B, C, FCE y E, con la sugerencia de anularlo entero.
 * `associatedLabel` es el asociado con articulo, letra y numero: `la factura C 00003-00000045`.
 */
export function creditNoteOverTotalError(options: {
  readonly associatedCurrency?: string;
  readonly associatedLabel: string;
  readonly associatedTotal: number;
  readonly noteCurrency: string;
  readonly noteTotal: number;
}): InputValidationError {
  const { associatedCurrency, associatedLabel, associatedTotal, noteCurrency, noteTotal } = options;

  return new InputValidationError(
    `La nota de crédito por ${formatMoneyLabel(noteTotal, noteCurrency)} no puede superar el total de ${describeTotal(associatedLabel, associatedTotal, associatedCurrency ?? noteCurrency)}.`,
    undefined,
    `Para anularla entera usá \`--monto ${formatArgentineAmountInput(associatedTotal)}\`.`,
  );
}

/** El mismo aviso en el paso del monto del asistente: `No puede superar el total de la factura C 00003-00000045, de $ 120.000.` */
export function creditNoteOverTotalHint(associatedLabel: string, total: number, currency?: string): string {
  return `No puede superar el total de ${describeTotal(associatedLabel, total, currency)}.`;
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
    throw creditNoteOverTotalError({
      associatedCurrency: associated.currency,
      associatedLabel,
      associatedTotal: associated.total,
      noteCurrency: note.currencyCode,
      noteTotal: note.total,
    });
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

export interface CheckedAssociated {
  readonly input: BillingCommandInput;
  /** Si ARCA no respondio y la nota igual se puede emitir: el tope de la NC queda sin controlar. */
  readonly warnings: readonly string[];
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : 'error desconocido';
}

/**
 * Lo que se controla contra el asociado de una nota A, B, C o FCE, con una sola consulta a ARCA antes de la vista
 * previa: que una NC no supere el total del asociado y, en una nota FCE sin `--afecha`, la fecha del asociado.
 * Devuelve la entrada con esa fecha, asi la vista previa la muestra y la emision no vuelve a consultar.
 *
 * Si ARCA no tiene el asociado o no responde, la nota FCE sin fecha no se puede armar y frena; en el resto ARCA
 * decide al emitir (si no respondio, con un aviso).
 */
export async function checkAssociatedInArca(options: {
  readonly gateway: Pick<VoucherHistoryGateway, 'getVoucher'>;
  readonly input: BillingCommandInput;
  readonly runtime: ResolvedArcaRuntime;
  readonly service: Pick<BillingService, 'buildVoucherPayload'>;
}): Promise<CheckedAssociated> {
  const { gateway, input, runtime, service } = options;
  const voucherKind = getVoucherKindByShortcut(input.shortcut);
  const associated = input.associatedVoucher;
  const unchanged: CheckedAssociated = { input, warnings: [] };

  if (!voucherKind || !associated || !shouldLookUpAssociated(input, voucherKind, runtime.context.cuit)) {
    return unchanged;
  }

  // Valida la entrada antes de consultar: si la nota no se puede armar, no hace falta ir a ARCA.
  const payload = service.buildVoucherPayload(input, runtime, voucherKind);
  const reference = payload.CbtesAsoc?.[0];

  if (!reference) {
    return unchanged;
  }

  const label = describeAssociated(reference.Tipo, reference.PtoVta, reference.Nro);
  const needsDate = voucherKind.isElectronicCredit && !associated.fecha;
  let voucher: IssuedVoucher | undefined;

  try {
    voucher = await gateway.getVoucher(reference.Nro, reference.PtoVta, reference.Tipo);
  } catch (error) {
    if (needsDate) {
      throw new InputValidationError(
        `No se pudo consultar en ARCA ${label} para tomar su fecha: ${reasonOf(error)}`,
        undefined,
        'Probá de nuevo en un rato o pasá la fecha del asociado con `--afecha <fecha>`.',
      );
    }

    return {
      input,
      warnings: [`No se pudo verificar en ARCA que la nota de crédito no supere ${label}: ${reasonOf(error)}`],
    };
  }

  if (!voucher) {
    if (needsDate) {
      throw new InputValidationError(
        `ARCA no tiene ${label}, así que no se puede tomar su fecha. Revisá \`--ac\`, \`--apv\` y \`--ar\`.`,
      );
    }

    return unchanged;
  }

  if (CREDIT_NOTE_FAMILIES.has(voucherKind.family)) {
    assertCreditNoteWithinAssociated({
      associated: voucher,
      associatedLabel: label,
      note: { currencyCode: payload.MonId, total: payload.ImpTotal },
    });
  }

  if (!needsDate) {
    return unchanged;
  }

  return {
    input: { ...input, associatedVoucher: { ...associated, fecha: formatArcaDateAsArgentineDate(voucher.date) } },
    warnings: [],
  };
}
