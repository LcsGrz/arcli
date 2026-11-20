import {
  ARGENTINE_DATE_FORMAT_HINT,
  formatDateAsArcaDate,
  parseArgentineDateInputAsArcaDate,
} from '../../lib/dates/arca-date';
import { InputValidationError } from '../../lib/errors/app-error';
import { describeInvalidCbu, parseCbu } from '../../lib/identity/cbu';
import { parseCuit } from '../../lib/identity/cuit';
import { EXCHANGE_RATE_DECIMALS, parseArgentineAmount } from '../../lib/numbers/argentine-amount';
import { parseStrictInteger } from '../../lib/numbers/strict-integer';
import { findRuleFailure } from '../../lib/rules/rules';
import { BILLING_DATE_WINDOW_RULE } from '../../modules/billing/billing.rules';
import type { BillingConcept } from '../../modules/billing/billing.schemas';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import { assertExportVoucherDate } from '../../modules/export/export.mappers';
import type { ExportType } from '../../modules/export/export.types';

export function validateAmount(value: string): string | true {
  const result = parseArgentineAmount(value);

  return result.ok ? true : `Monto inválido: ${result.reason}. Por ejemplo 150000, 150.000 o 1.500,50.`;
}

export function validateCuit(value: string): string | true {
  const result = parseCuit(value);

  return result.ok ? true : `El CUIT ${result.reason}.`;
}

export function validateCuil(value: string): string | true {
  const result = parseCuit(value);

  return result.ok ? true : `El CUIL ${result.reason}.`;
}

export function validateDni(value: string): string | true {
  return /^\d{6,8}$/.test(value.replace(/\./g, '')) ? true : 'El DNI tiene de 6 a 8 dígitos.';
}

export function validateCbu(value: string): string | true {
  const result = parseCbu(value);

  return result.ok ? true : describeInvalidCbu(result.reason);
}

/** Como `--alias`: vacio vale (no se informa); si no, de 6 a 20 letras, números, puntos o guiones. */
export function validateOptionalCbuAlias(value: string): string | true {
  return !value.trim() || /^[A-Za-z0-9.-]{6,20}$/.test(value.trim())
    ? true
    : 'El alias tiene entre 6 y 20 letras, números, puntos o guiones.';
}

export function normalizeDocumentNumber(value: string): number {
  return Number(value.replace(/[-.]/g, ''));
}

export function validateDate(value: string): string | true {
  try {
    parseArgentineDateInputAsArcaDate(value);

    return true;
  } catch {
    return `Fecha inválida. ${ARGENTINE_DATE_FORMAT_HINT}`;
  }
}

/** Fecha del comprobante: la misma ventana que el CLI (`--fecha`), que depende del concepto y del comprobante. */
export function validateBillingDate(
  value: string,
  concept: BillingConcept,
  voucherKind: VoucherKindDefinition,
  now = new Date(),
): string | true {
  const valid = validateDate(value);

  if (valid !== true) {
    return valid;
  }

  const found = findRuleFailure(
    [BILLING_DATE_WINDOW_RULE],
    { billingDate: value, concept },
    { today: formatDateAsArcaDate(now), voucherKind },
  );

  return found ? (found.failure.question ?? found.failure.message) : true;
}

/**
 * Fecha de la factura o nota E: la misma ventana que `--fecha` en `arcli fe` (`assertExportVoucherDate`, error 1500),
 * que en servicios no pasa del fin de mes.
 */
export function validateExportVoucherDate(value: string, exportType: ExportType, now = new Date()): string | true {
  const valid = validateDate(value);

  if (valid !== true) {
    return valid;
  }

  try {
    assertExportVoucherDate({
      exportType,
      today: formatDateAsArcaDate(now),
      voucherDate: parseArgentineDateInputAsArcaDate(value, now),
    });

    return true;
  } catch (error) {
    if (error instanceof InputValidationError) {
      return error.message;
    }

    throw error;
  }
}

/** Fecha opcional: vacia vale (va la de por defecto); si no, tiene que ser una fecha valida. */
export function validateOptionalDate(value: string): string | true {
  return value.trim() ? validateDate(value) : true;
}

/** Un entero mayor a 0 (punto de venta, numero de comprobante, actividad); `label` nombra el dato en el error. */
export function validatePositiveInteger(label: string): (value: string) => string | true {
  return (value) => {
    const number = parseStrictInteger(value);

    return number !== undefined && number >= 1 ? true : `${label} tiene que ser un número entero positivo.`;
  };
}

export const validatePointOfSale = validatePositiveInteger('El punto de venta');

/** Monto opcional: vacio es "no", si no tiene que ser un monto valido. */
export function validateOptionalAmount(value: string): string | true {
  return value.trim() === '' ? true : validateAmount(value);
}

export function validateExchangeRate(value: string): string | true {
  const result = parseArgentineAmount(value, { maxDecimals: EXCHANGE_RATE_DECIMALS });

  if (!result.ok) {
    return `Cotización inválida: ${result.reason}. Por ejemplo 1200 o 1.185,50.`;
  }

  return result.value !== 1 ? true : 'Ingresá la cotización acordada, por ejemplo 1200 o 1.185,50.';
}
