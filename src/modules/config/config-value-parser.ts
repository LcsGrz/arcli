import { resolve } from 'node:path';
import type { z } from 'zod';

import { parseFullArgentineDateAsArcaDate } from '../../lib/dates/arca-date';
import { InputIssuesError, InputValidationError } from '../../lib/errors/app-error';
import type { LocalFiles } from '../../lib/files/local-files';
import { describeInvalidCbu, parseCbu } from '../../lib/identity/cbu';
import { describeInvalidCbuAlias, parseCbuAlias } from '../../lib/identity/cbu-alias';
import { parseCuit } from '../../lib/identity/cuit';
import { EXCHANGE_RATE_DECIMALS, parseArgentineAmount } from '../../lib/numbers/argentine-amount';
import { parseStrictInteger } from '../../lib/numbers/strict-integer';
import { readPemFile } from '../../lib/security/pem';
import { IVA_RATE_HINT } from '../billing/billing.schemas';
import { describeZodIssues } from '../billing/billing.zod-errors';
import { saleConditionSchema } from '../billing/sale-condition';
import { MAX_RECENT_VOUCHERS } from '../vouchers/voucher-history';

import {
  arcliConfigSchema,
  arcliDefaultConceptSchema,
  arcliDefaultIvaConditionSchema,
  arcliDefaultIvaRateSchema,
  arcliEnvironmentSchema,
  arcliPdfModeSchema,
} from './config.schemas';
import type { CanonicalConfigKey } from './config-key-table';

/**
 * Como se nombra el valor en un mensaje: con la clave si se sabe (\`config establecer\`) o "El valor" en el modo
 * interactivo, donde la pregunta ya dice que dato es.
 */
function subjectOf(displayKey: string | undefined): string {
  return displayKey ? `\`${displayKey}\`` : 'El valor';
}

/** Un valor de una lista cerrada, con la clave, lo que llego y los valores validos en el mensaje. */
function parseChoice<T extends string>(
  schema: z.ZodEnum<Record<T, T>>,
  value: string,
  displayKey: string | undefined,
): T {
  const result = schema.safeParse(value.trim().toLowerCase());

  if (!result.success) {
    const subject = displayKey ? `\`${displayKey}\` no acepta` : 'No se acepta';

    // `detalles` del `--json` queda como antes de mejorar el mensaje: los problemas de zod.
    throw new InputIssuesError(
      `${subject} "${value}". Valores válidos: ${schema.options.join(', ')}.`,
      describeZodIssues(result.error),
    );
  }

  return result.data;
}

function parseBoolean(value: string, displayKey?: string): boolean {
  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === 'true' || normalizedValue === '1' || normalizedValue === 'si' || normalizedValue === 'sí') {
    return true;
  }

  if (normalizedValue === 'false' || normalizedValue === '0' || normalizedValue === 'no') {
    return false;
  }

  throw new InputValidationError(
    `${displayKey ? `\`${displayKey}\` no acepta "${value}"` : `El valor "${value}" no es un booleano válido`}. Usá true/false, si/no o 1/0.`,
  );
}

function parseNonEmptyString(value: string, displayKey?: string): string {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new InputValidationError(`${subjectOf(displayKey)} no puede estar vacío.`);
  }

  return normalizedValue;
}

function parseIvaRate(value: string): string {
  const result = arcliDefaultIvaRateSchema.safeParse(value);

  if (!result.success) {
    throw new InputValidationError(`La alícuota "${value}" no es válida. Usá ${IVA_RATE_HINT}.`);
  }

  return result.data;
}

function parseConfigCuit(value: string): string {
  const result = parseCuit(value);

  if (!result.ok) {
    throw new InputValidationError(`El CUIT "${value}" no es válido: ${result.reason}.`);
  }

  return result.value;
}

/** Una de las condiciones de venta o un texto libre corto, para el PDF. */
function parseSaleCondition(value: string, displayKey?: string): string {
  const result = saleConditionSchema.safeParse(value);

  if (!result.success) {
    const reason = value.trim() ? 'no puede tener más de 100 caracteres' : 'no puede estar vacío';

    throw new InputIssuesError(`${subjectOf(displayKey)} ${reason}.`, describeZodIssues(result.error));
  }

  return result.data;
}

/** El codigo de 3 caracteres de ARCA (`PES`, `DOL`, `060`), con el mismo esquema con el que se guarda la config. */
const currencyKeySchema = arcliConfigSchema.pick({ monedaPorDefecto: true });

function parseCurrencyCode(value: string, displayKey?: string): string {
  const normalizedValue = value.trim().toUpperCase();
  const result = currencyKeySchema.safeParse({ monedaPorDefecto: normalizedValue });

  if (!result.success) {
    throw new InputIssuesError(
      `${displayKey ? `\`${displayKey}\` no acepta "${value}"` : `El código de moneda "${value}" no es válido`}: tiene que ser un código de moneda de 3 caracteres, como PES o DOL. Los ves con \`arcli parametros monedas\`.`,
      describeZodIssues(result.error),
    );
  }

  return normalizedValue;
}

function parseCbuValue(value: string): string {
  const result = parseCbu(value);

  if (!result.ok) {
    throw new InputValidationError(describeInvalidCbu(result.reason, value));
  }

  return result.value;
}

function parseCbuAliasValue(value: string): string {
  const result = parseCbuAlias(value);

  if (!result.ok) {
    throw new InputValidationError(describeInvalidCbuAlias(result.reason, value));
  }

  return result.value;
}

function parsePositiveInteger(value: string, displayKey?: string): number {
  const parsedValue = parseStrictInteger(value);

  if (parsedValue === undefined || parsedValue <= 0) {
    throw new InputValidationError(
      `${displayKey ? `\`${displayKey}\` no acepta "${value}": tiene que ser` : `El valor "${value}" no es`} un entero positivo válido.`,
    );
  }

  return parsedValue;
}

function parseRecentCount(value: string): number {
  const parsedValue = parseStrictInteger(value);

  if (parsedValue === undefined || parsedValue < 1 || parsedValue > MAX_RECENT_VOUCHERS) {
    throw new InputValidationError(
      `La cantidad "${value}" no es válida: tiene que ser un número entre 1 y ${MAX_RECENT_VOUCHERS}.`,
    );
  }

  return parsedValue;
}

/** Un importe en pesos mayor a cero, escrito como en los flags: `30.000.000` o `30000000,50`. */
function parsePositiveAmount(value: string, displayKey?: string): number {
  const result = parseArgentineAmount(value);

  if (!result.ok || result.value <= 0) {
    throw new InputValidationError(
      `${subjectOf(displayKey)} no acepta "${value}": tiene que ser un importe en pesos mayor a cero, por ejemplo 30.000.000.`,
    );
  }

  return result.value;
}

function parseExchangeRate(value: string): number {
  const result = parseArgentineAmount(value, { maxDecimals: EXCHANGE_RATE_DECIMALS });

  if (!result.ok) {
    throw new InputValidationError(`La cotización "${value}" no es válida: ${result.reason}.`);
  }

  return result.value;
}

// Ruta absoluta, como pdfCarpeta: una relativa dependeria de la carpeta desde donde se corre arcli.
function parsePemPath(value: string, label: 'certificado' | 'clave privada', files: LocalFiles): string {
  const path = resolve(parseNonEmptyString(value));

  readPemFile(files, path, label);

  return path;
}

// La fecha de inicio de actividades es vieja: se pide con anio para no completarla con el actual.
function parseFullDate(value: string): string {
  const date = parseFullArgentineDateAsArcaDate(value);

  if (!date) {
    throw new InputValidationError(`La fecha "${value}" no es válida. Usá D/MM/YYYY, por ejemplo 1/03/2020.`);
  }

  return date;
}

function parseExistingFile(value: string, label: string, files: LocalFiles): string {
  const path = resolve(parseNonEmptyString(value));

  if (!files.exists(path)) {
    throw new InputValidationError(`No se encontró ${label} en "${path}".`);
  }

  return path;
}

function parseLogoPath(value: string, files: LocalFiles): string {
  const path = parseExistingFile(value, 'el logo', files);

  if (!/\.(png|jpe?g)$/i.test(path)) {
    throw new InputValidationError('El logo debe ser un archivo PNG o JPG.');
  }

  return path;
}

/**
 * Valida y normaliza el valor de una clave. `displayKey` es la clave como la escribio la persona (\`entorno\`, no
 * \`entornoPorDefecto\`): con ella, los mensajes de los valores que no se explican solos la nombran. `files` lee las
 * rutas (certificado, clave, logo, navegador) para validarlas.
 */
export function parseConfigValue(
  key: CanonicalConfigKey,
  value: string,
  files: LocalFiles,
  displayKey?: string,
): boolean | number | string {
  switch (key) {
    case 'alicuotaPorDefecto':
      return parseIvaRate(value);
    case 'aliasCbu':
      return parseCbuAliasValue(value);
    case 'cbu':
      return parseCbuValue(value);
    case 'conceptoPorDefecto':
      return parseChoice(arcliDefaultConceptSchema, value, displayKey);
    case 'condicionVenta':
      return parseSaleCondition(value, displayKey);
    case 'cotizacionPorDefecto':
      return parseExchangeRate(value);
    case 'cuit':
      return parseConfigCuit(value);
    case 'filasPorLista':
      return parseRecentCount(value);
    case 'emisor.condicionIva':
      return parseChoice(arcliDefaultIvaConditionSchema, value, displayKey);
    case 'emisor.domicilio':
    case 'emisor.iibb':
    case 'emisor.razonSocial':
      return parseNonEmptyString(value, displayKey);
    case 'emisor.inicioActividades':
      return parseFullDate(value);
    case 'emisor.logo':
      return parseLogoPath(value, files);
    case 'entornoPorDefecto':
      return parseChoice(arcliEnvironmentSchema, value, displayKey);
    case 'ivaReceptorPorDefecto':
      return parseChoice(arcliDefaultIvaConditionSchema, value, displayKey);
    case 'monedaPorDefecto':
      return parseCurrencyCode(value, displayKey);
    case 'monotributo.tope':
      return parsePositiveAmount(value, displayKey);
    case 'verificarFce':
    case 'consultarPadron':
    case 'output.emitirPorDefecto':
    case 'output.jsonPorDefecto':
    case 'output.brutoPorDefecto':
      return parseBoolean(value, displayKey);
    case 'pdf':
      return parseChoice(arcliPdfModeSchema, value, displayKey);
    case 'pdfCarpeta':
      return resolve(parseNonEmptyString(value, displayKey));
    case 'pdfNavegador':
      return parseExistingFile(value, 'el navegador', files);
    case 'puntoVentaPorDefecto':
    case 'exportacion.actividad':
      return parsePositiveInteger(value, displayKey);
    case 'ticketPath':
      return resolve(parseNonEmptyString(value, displayKey));
    case 'cert.produccion':
    case 'cert.testing':
    case 'exportacion.cert.produccion':
    case 'exportacion.cert.testing':
      return parsePemPath(value, 'certificado', files);
    case 'key.produccion':
    case 'key.testing':
    case 'exportacion.key.produccion':
    case 'exportacion.key.testing':
      return parsePemPath(value, 'clave privada', files);
    default:
      return parseNonEmptyString(value, displayKey);
  }
}
