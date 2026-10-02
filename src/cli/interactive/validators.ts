import { parseArgentineDateInputAsArcaDate } from '../../lib/dates/arca-date';
import { parseAmountInput } from '../../modules/interactive/amount-input';

export function validateAmount(value: string): string | true {
  return parseAmountInput(value) ? true : 'Ingresa un monto mayor a 0, por ejemplo 150000 o 1500,50.';
}

export function validateCuit(value: string): string | true {
  return /^\d{11}$/.test(value.replace(/-/g, '')) ? true : 'El CUIT tiene 11 digitos.';
}

export function validateDni(value: string): string | true {
  return /^\d{7,8}$/.test(value.replace(/\./g, '')) ? true : 'El DNI tiene 7 u 8 digitos.';
}

export function validateCbu(value: string): string | true {
  return /^\d{22}$/.test(value) ? true : 'El CBU tiene 22 digitos.';
}

export function normalizeDocumentNumber(value: string): number {
  return Number(value.replace(/[-.]/g, ''));
}

export function validateDate(value: string): string | true {
  try {
    parseArgentineDateInputAsArcaDate(value);

    return true;
  } catch {
    return 'Fecha invalida. Usa D/M/AAAA, D/M o solo el dia (por ejemplo 15/10).';
  }
}

/** Monto opcional: vacio es "no", si no tiene que ser un monto valido. */
export function validateOptionalAmount(value: string): string | true {
  return value.trim() === '' ? true : validateAmount(value);
}

export function validateExchangeRate(value: string): string | true {
  const rate = parseAmountInput(value);

  return rate && rate !== 1 ? true : 'Ingresa la cotizacion acordada, por ejemplo 1200 o 1185,50.';
}
