import {
  ARGENTINE_DATE_FORMAT_HINT,
  formatDateAsArcaDate,
  parseArgentineDateInputAsArcaDate,
} from '../../lib/dates/arca-date';
import { InputValidationError } from '../../lib/errors/app-error';
import { parseCuit } from '../../lib/identity/cuit';
import { EXCHANGE_RATE_DECIMALS, parseArgentineAmount } from '../../lib/numbers/argentine-amount';
import { parseStrictInteger } from '../../lib/numbers/strict-integer';
import type { BillingConcept } from '../../modules/billing/billing.schemas';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import { validateBillingDateWindow } from '../../modules/billing/billing.validation';

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
  return /^\d{7,8}$/.test(value.replace(/\./g, '')) ? true : 'El DNI tiene 7 u 8 dígitos.';
}

export function validateCbu(value: string): string | true {
  return /^\d{22}$/.test(value) ? true : 'El CBU tiene 22 dígitos.';
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

  try {
    validateBillingDateWindow(
      parseArgentineDateInputAsArcaDate(value, now),
      formatDateAsArcaDate(now),
      concept,
      voucherKind,
    );

    return true;
  } catch (error) {
    if (error instanceof InputValidationError) {
      return error.message;
    }

    throw error;
  }
}

export function validatePointOfSale(value: string): string | true {
  const number = parseStrictInteger(value);

  return number !== undefined && number >= 1 ? true : 'El punto de venta tiene que ser un número entero positivo.';
}

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
