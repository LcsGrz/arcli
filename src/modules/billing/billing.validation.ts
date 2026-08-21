import { InputValidationError } from '../../lib/errors/app-error';

import { formatDocumentFlag, formatVoucherLabel } from './billing.mappers';
import type { BillingCommandInput } from './billing.schemas';
import type { VoucherKindDefinition } from './billing.types';

export function ensureDateOrder(serviceStartDate: string, serviceEndDate: string): void {
  if (serviceStartDate > serviceEndDate) {
    throw new InputValidationError('La fecha de inicio de servicio no puede ser posterior a la fecha de fin.');
  }
}

export function validateConceptDateInputs(input: BillingCommandInput): void {
  const hasAnyServiceDate = Boolean(input.serviceStartDate || input.serviceEndDate);
  const hasPartialServiceDate = Boolean(input.serviceStartDate) !== Boolean(input.serviceEndDate);

  if (input.concept === 'productos') {
    if (hasAnyServiceDate) {
      throw new InputValidationError(
        'El concepto "productos" no usa fechas de servicio. Quite --servicio-desde y --servicio-hasta.',
      );
    }

    if (input.dueDay) {
      throw new InputValidationError('El concepto "productos" no usa --dia. Use solo fecha o monto.');
    }

    return;
  }

  if (hasPartialServiceDate) {
    throw new InputValidationError(
      'Si informa fechas de servicio, debe enviar ambas: --servicio-desde y --servicio-hasta.',
    );
  }
}

export function validateDocumentIdentity(input: BillingCommandInput, voucherKind: VoucherKindDefinition): void {
  if (input.documentType === 'consumidor-final') {
    if (input.ivaCondition !== 'consumidor-final') {
      throw new InputValidationError(
        `La ${formatVoucherLabel(voucherKind)} usa consumidor final solo con --ir-cf o --iva-receptor consumidor-final.`,
      );
    }

    if (typeof input.documentNumber === 'number' && input.documentNumber !== 0) {
      throw new InputValidationError(
        `La ${formatVoucherLabel(voucherKind)} usa consumidor final solo con documento 0. Use --consumidor-final.`,
      );
    }

    return;
  }

  if (typeof input.documentNumber !== 'number') {
    throw new InputValidationError(
      `La ${formatVoucherLabel(voucherKind)} requiere documento del receptor. Use ${formatDocumentFlag(input.documentType)}.`,
    );
  }

  if (
    (input.documentType === 'cuit' || input.documentType === 'cuil') &&
    !/^\d{11}$/.test(String(input.documentNumber))
  ) {
    throw new InputValidationError(
      `${formatDocumentFlag(input.documentType)} debe tener 11 digitos en ${formatVoucherLabel(voucherKind)}.`,
    );
  }

  if (input.documentType === 'dni' && !/^\d{7,8}$/.test(String(input.documentNumber))) {
    throw new InputValidationError(`--dni debe tener 7 u 8 digitos en ${formatVoucherLabel(voucherKind)}.`);
  }
}
