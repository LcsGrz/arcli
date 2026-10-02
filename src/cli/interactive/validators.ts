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
