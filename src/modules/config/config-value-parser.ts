import { readPemFile } from '../../lib/security/pem';

import { arcliDefaultConceptSchema, arcliDefaultIvaConditionSchema, arcliEnvironmentSchema } from './config.schemas';

export type CanonicalConfigKey =
  | 'cert.produccion'
  | 'cert.testing'
  | 'conceptoPorDefecto'
  | 'cotizacionPorDefecto'
  | 'cuit'
  | 'entornoPorDefecto'
  | 'ivaReceptorPorDefecto'
  | 'key.produccion'
  | 'key.testing'
  | 'monedaPorDefecto'
  | 'output.emitirPorDefecto'
  | 'output.jsonPorDefecto'
  | 'output.brutoPorDefecto'
  | 'puntoVentaPorDefecto'
  | 'ticketPath';

function parseBoolean(value: string): boolean {
  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === 'true' || normalizedValue === '1' || normalizedValue === 'si' || normalizedValue === 'sí') {
    return true;
  }

  if (normalizedValue === 'false' || normalizedValue === '0' || normalizedValue === 'no') {
    return false;
  }

  throw new Error(`El valor "${value}" no es un booleano valido. Use true/false, si/no o 1/0.`);
}

function parseNonEmptyString(value: string): string {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new Error('El valor no puede estar vacio.');
  }

  return normalizedValue;
}

function parsePositiveInteger(value: string): number {
  const parsedValue = Number.parseInt(value.trim(), 10);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`El valor "${value}" no es un entero positivo valido.`);
  }

  return parsedValue;
}

function parsePositiveNumber(value: string): number {
  const parsedValue = Number.parseFloat(value.trim());

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error(`El valor "${value}" no es un numero positivo valido.`);
  }

  return parsedValue;
}

function parsePemPath(value: string, label: 'certificado' | 'clave privada'): string {
  const normalizedValue = parseNonEmptyString(value);

  readPemFile(normalizedValue, label);

  return normalizedValue;
}

export function parseConfigValue(key: CanonicalConfigKey, value: string): boolean | number | string {
  switch (key) {
    case 'conceptoPorDefecto':
      return arcliDefaultConceptSchema.parse(value.trim().toLowerCase());
    case 'cotizacionPorDefecto':
      return parsePositiveNumber(value);
    case 'cuit':
      return value.trim();
    case 'entornoPorDefecto':
      return arcliEnvironmentSchema.parse(value.trim().toLowerCase());
    case 'ivaReceptorPorDefecto':
      return arcliDefaultIvaConditionSchema.parse(value.trim().toLowerCase());
    case 'monedaPorDefecto':
      return value.trim().toUpperCase();
    case 'output.emitirPorDefecto':
    case 'output.jsonPorDefecto':
    case 'output.brutoPorDefecto':
      return parseBoolean(value);
    case 'puntoVentaPorDefecto':
      return parsePositiveInteger(value);
    case 'ticketPath':
      return parseNonEmptyString(value);
    case 'cert.produccion':
    case 'cert.testing':
      return parsePemPath(value, 'certificado');
    case 'key.produccion':
    case 'key.testing':
      return parsePemPath(value, 'clave privada');
    default:
      return parseNonEmptyString(value);
  }
}
