import { formatArcaDateAsArgentineDate, formatDateAsArcaDate } from '../../lib/dates/arca-date';
import { dateInputHint } from '../../lib/dates/date-input-text';
import { parseDateInputAsArcaDate } from '../../lib/dates/relative-date';
import { InputValidationError } from '../../lib/errors/app-error';
import { describeInvalidCbu, parseCbu } from '../../lib/identity/cbu';
import { describeInvalidCbuAlias, parseCbuAlias } from '../../lib/identity/cbu-alias';
import { parseCuit } from '../../lib/identity/cuit';
import { parseDni } from '../../lib/identity/dni';
import { EXCHANGE_RATE_DECIMALS, parseArgentineAmount } from '../../lib/numbers/argentine-amount';
import { parseStrictInteger } from '../../lib/numbers/strict-integer';
import { findRuleFailure } from '../../lib/rules/rules';
import { BILLING_DATE_WINDOW_RULE } from '../billing/billing.rules';
import type { BillingConcept } from '../billing/billing.schemas';
import type { VoucherKindDefinition } from '../billing/billing.types';
import { assertExportVoucherDate } from '../export/export.mappers';
import type { ExportType } from '../export/export.types';

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
  const result = parseDni(value);

  return result.ok ? true : `El DNI tiene ${result.reason}.`;
}

export function validateCbu(value: string): string | true {
  const result = parseCbu(value);

  return result.ok ? true : describeInvalidCbu(result.reason);
}

/** Como `--alias`: vacio vale (no se informa); si no, de 6 a 20 letras, números, puntos o guiones. */
export function validateOptionalCbuAlias(value: string): string | true {
  if (!value.trim()) {
    return true;
  }

  const result = parseCbuAlias(value);

  return result.ok ? true : describeInvalidCbuAlias(result.reason);
}

export function normalizeDocumentNumber(value: string): number {
  return Number(value.replace(/[-.]/g, ''));
}

/**
 * Las fechas reciben `now` de quien pregunta: el núcleo no lee el reloj.
 *
 * Una fecha como en los flags: escrita a mano (`5`, `15/11`, `15/11/2026`) o relativa (`hoy`, `ayer`, `+N`, `-N`).
 * El error es uno solo, con los formatos de `dateInputHint` y sin flags: el de una palabra de mes nombra `--sd` (TUI-18).
 */
export function validateDate(value: string, now: Date): string | true {
  try {
    parseDateInputAsArcaDate(value, 'day', now);

    return true;
  } catch (error) {
    if (error instanceof InputValidationError) {
      return `Fecha inválida. ${dateInputHint()}`;
    }

    throw error;
  }
}

/** Fecha del comprobante: la misma ventana que el CLI (`--fecha`), que depende del concepto y del comprobante. */
export function validateBillingDate(
  value: string,
  concept: BillingConcept,
  voucherKind: VoucherKindDefinition,
  now: Date,
): string | true {
  const valid = validateDate(value, now);

  if (valid !== true) {
    return valid;
  }

  const found = findRuleFailure(
    [BILLING_DATE_WINDOW_RULE],
    { billingDate: formatArcaDateAsArgentineDate(parseDateInputAsArcaDate(value, 'day', now)), concept },
    { today: formatDateAsArcaDate(now), voucherKind },
  );

  return found ? (found.failure.question ?? found.failure.message) : true;
}

/**
 * Fecha de la factura o nota E: la misma ventana que `--fecha` en `arcli fe` (`assertExportVoucherDate`, error 1500),
 * que en servicios no pasa del fin de mes.
 */
export function validateExportVoucherDate(value: string, exportType: ExportType, now: Date): string | true {
  const valid = validateDate(value, now);

  if (valid !== true) {
    return valid;
  }

  try {
    assertExportVoucherDate({
      exportType,
      today: formatDateAsArcaDate(now),
      voucherDate: parseDateInputAsArcaDate(value, 'day', now),
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
export function validateOptionalDate(value: string, now: Date): string | true {
  return value.trim() ? validateDate(value, now) : true;
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

/** Cantidad o precio de un item de la E, como `--item`: hasta seis decimales y mayor a 0. */
export function validateItemNumber(label: string): (value: string) => string | true {
  return (value) => {
    const parsed = parseArgentineAmount(value, { maxDecimals: EXCHANGE_RATE_DECIMALS });

    if (!parsed.ok) {
      return `${label} no tiene un formato válido: ${parsed.reason}.`;
    }

    return parsed.value > 0 ? true : `${label} tiene que ser mayor a 0.`;
  };
}

/** Un codigo de moneda escrito a mano, si no se tiene la tabla de ARCA para compararlo. */
export function validateCurrencyCode(value: string): string | true {
  return /^[a-z0-9]{3}$/i.test(value.trim())
    ? true
    : 'La moneda va con su código de tres caracteres: el ISO, como EUR, o el de ARCA, como 060.';
}
