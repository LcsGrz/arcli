import { readPemFile } from '../../lib/security/pem';
import { IVA_RATE_HINT } from '../billing/billing.schemas';

import {
  arcliDefaultConceptSchema,
  arcliDefaultIvaConditionSchema,
  arcliDefaultIvaRateSchema,
  arcliEnvironmentSchema,
} from './config.schemas';

export type CanonicalConfigKey =
  | 'alicuotaPorDefecto'
  | 'aliasCbu'
  | 'cbu'
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
  | 'ticketPath'
  | 'verificarFce';

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

function parseIvaRate(value: string): string {
  const result = arcliDefaultIvaRateSchema.safeParse(value);

  if (!result.success) {
    throw new Error(`La alicuota "${value}" no es valida. Use ${IVA_RATE_HINT}.`);
  }

  return result.data;
}

function parseCbu(value: string): string {
  const normalizedValue = value.trim();

  if (!/^\d{22}$/.test(normalizedValue)) {
    throw new Error(`El CBU "${value}" no es valido: debe tener 22 digitos.`);
  }

  return normalizedValue;
}

function parseCbuAlias(value: string): string {
  const normalizedValue = value.trim();

  if (!/^[A-Za-z0-9.-]{6,20}$/.test(normalizedValue)) {
    throw new Error(`El alias "${value}" no es valido: debe tener entre 6 y 20 letras, numeros, puntos o guiones.`);
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
    case 'alicuotaPorDefecto':
      return parseIvaRate(value);
    case 'aliasCbu':
      return parseCbuAlias(value);
    case 'cbu':
      return parseCbu(value);
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
    case 'verificarFce':
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
