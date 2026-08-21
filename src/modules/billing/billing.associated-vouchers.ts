import type { ICbtesAsoc } from '@arcasdk/core/lib/domain/types/voucher.types';

import { InputValidationError } from '../../lib/errors/app-error';

import { formatVoucherLabel } from './billing.mappers';
import type { BillingCommandInput } from './billing.schemas';
import type { VoucherKindDefinition } from './billing.types';

interface ResolveAssociatedVoucherOptions {
  readonly input: BillingCommandInput;
  readonly requireVoucherKind: (shortcut: string) => VoucherKindDefinition;
  readonly voucherKind: VoucherKindDefinition;
}

export function resolveAssociatedVouchers(options: ResolveAssociatedVoucherOptions): ICbtesAsoc[] | undefined {
  const { input, requireVoucherKind, voucherKind } = options;

  if (!voucherKind.requiresAssociatedVoucher) {
    if (input.associatedVoucher) {
      throw new InputValidationError(`El comprobante ${formatVoucherLabel(voucherKind)} no usa comprobante asociado.`);
    }

    return undefined;
  }

  const associatedVoucher = input.associatedVoucher;
  const associatedVoucherType =
    associatedVoucher?.tipo ?? resolveAssociatedVoucherType(associatedVoucher?.shortcut, requireVoucherKind);
  const associatedVoucherKind = associatedVoucher?.shortcut
    ? requireVoucherKind(associatedVoucher.shortcut)
    : undefined;

  if (
    !associatedVoucher?.numero ||
    !associatedVoucher.puntoVenta ||
    !associatedVoucherType ||
    !associatedVoucher.cuit
  ) {
    throw new InputValidationError(
      `El comprobante ${formatVoucherLabel(voucherKind)} requiere comprobante asociado. Use --ac o --at, junto con --apv o --asociado-punto-venta, --ar y --acuit.`,
    );
  }

  if (associatedVoucherKind) {
    validateAssociatedVoucherKind(associatedVoucherKind, voucherKind);
  }

  return [
    {
      Cuit: associatedVoucher.cuit,
      Nro: associatedVoucher.numero,
      PtoVta: associatedVoucher.puntoVenta,
      Tipo: associatedVoucherType,
    },
  ];
}

function resolveAssociatedVoucherType(
  shortcut: string | undefined,
  requireVoucherKind: (shortcut: string) => VoucherKindDefinition,
): number | undefined {
  if (!shortcut) {
    return undefined;
  }

  return requireVoucherKind(shortcut).arcaType;
}

function validateAssociatedVoucherKind(
  associatedVoucherKind: VoucherKindDefinition,
  voucherKind: VoucherKindDefinition,
): void {
  if (associatedVoucherKind.family !== 'factura' && associatedVoucherKind.family !== 'factura-credito-electronica') {
    throw new InputValidationError(
      `El comprobante asociado de ${formatVoucherLabel(voucherKind)} debe ser una factura, no otra nota.`,
    );
  }

  if (associatedVoucherKind.letter !== voucherKind.letter) {
    throw new InputValidationError(
      `El comprobante asociado debe usar la misma letra que ${formatVoucherLabel(voucherKind)}.`,
    );
  }

  if (associatedVoucherKind.isElectronicCredit !== voucherKind.isElectronicCredit) {
    throw new InputValidationError(
      `El comprobante asociado debe pertenecer a la misma categoria electronica que ${formatVoucherLabel(voucherKind)}.`,
    );
  }
}
