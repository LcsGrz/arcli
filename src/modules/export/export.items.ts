import Big from 'big.js';

import { InputValidationError } from '../../lib/errors/app-error';
import { formatArgentineAmount, parseArgentineAmount } from '../../lib/numbers/argentine-amount';
import { roundAmount } from '../billing/billing.amounts';

import {
  DEFAULT_EXPORT_UNIT_CODE,
  type ExportItemInput,
  type ExportItemPayload,
  type ExportUnit,
} from './export.types';

export const DEFAULT_EXPORT_ITEM_DESCRIPTION = 'Según detalle';

const ITEM_FORMAT_HINT =
  'Usá `--item "codigo|descripcion|cantidad|precio|unidad"` (el código y la unidad son opcionales).';

export interface ExportItemsResult {
  readonly items: ExportItemPayload[];
  /** Suma de los items con dos decimales. */
  readonly total: number;
}

function parseItemAmount(part: string, field: string, raw: string): number {
  const parsed = parseArgentineAmount(part, { maxDecimals: 6 });

  if (!parsed.ok) {
    throw new InputValidationError(`${field} del ítem "${raw}" no tiene un formato válido: ${parsed.reason}.`);
  }

  return parsed.value;
}

/**
 * Un item por flag. Se separa con `|` para no pelear con las comas de los importes:
 * `001|Servicio de consultoria|1|1000|unidad`. Con cuatro partes se omite el codigo y con tres la unidad.
 */
export function parseExportItemArgument(raw: string): ExportItemInput {
  const parts = raw.split('|').map((part) => part.trim());

  if (parts.length < 3 || parts.length > 5) {
    throw new InputValidationError(`El ítem "${raw}" no es válido. ${ITEM_FORMAT_HINT}`);
  }

  const [codeOrDescription, ...rest] = parts;
  const description = parts.length === 5 ? rest.shift() : codeOrDescription;
  const [quantityPart, pricePart, unitPart] = rest;

  if (!description || !quantityPart || !pricePart) {
    throw new InputValidationError(`El ítem "${raw}" no es válido: falta la descripción, la cantidad o el precio.`);
  }

  return {
    code: parts.length === 5 ? codeOrDescription : undefined,
    description,
    quantity: parseItemAmount(quantityPart, 'La cantidad', raw),
    unit: unitPart ? resolveExportItemUnit(unitPart) : DEFAULT_EXPORT_UNIT_CODE,
    unitPrice: parseItemAmount(pricePart, 'El precio', raw),
  };
}

/** La unidad del item puede ser el codigo de ARCA (`7`) o el nombre de la tabla (`unidad`). */
function resolveExportItemUnit(unit: string | number): string | number {
  if (typeof unit === 'number') {
    return unit;
  }

  const trimmed = unit.trim();

  if (!trimmed) {
    throw new InputValidationError(
      'La unidad del ítem no puede estar vacía. Usá `--item` sin la última parte para usar "unidad".',
    );
  }

  return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}

/**
 * La tabla de ARCA escribe las unidades en plural ("unidades", "kilogramos") y los ejemplos del CLI en singular
 * ("unidad"): se aceptan las dos formas, sin inventar codigos para nombres que no estan en la tabla.
 */
function singularUnitName(value: string): string {
  if (/[dlrnz]es$/.test(value)) {
    return value.slice(0, -2);
  }

  return value.endsWith('s') ? value.slice(0, -1) : value;
}

function findUnitByName(units: readonly ExportUnit[], normalized: string): ExportUnit | undefined {
  const exact = units.find((entry) => entry.name.trim().toLowerCase() === normalized);

  if (exact) {
    return exact;
  }

  const singular = singularUnitName(normalized);
  const matches = units.filter((entry) => singularUnitName(entry.name.trim().toLowerCase()) === singular);

  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Codigo de ARCA de la unidad: si viene un nombre se busca en la tabla de WSFEX. Un nombre desconocido
 * es un error, no un default silencioso.
 */
export function resolveUnitCode(unit: string | number | undefined, units: readonly ExportUnit[]): number {
  if (typeof unit === 'number') {
    const known = units.find((entry) => entry.id === unit);

    if (units.length > 0 && !known) {
      throw new InputValidationError(`La unidad ${unit} no existe en la tabla de ARCA.`);
    }

    return unit;
  }

  if (typeof unit === 'string') {
    const match = findUnitByName(units, unit.trim().toLowerCase());

    if (match) {
      return match.id;
    }

    throw new InputValidationError(
      `La unidad "${unit}" no existe en la tabla de ARCA. Usá el nombre tal como lo informa ARCA o el código numérico.`,
    );
  }

  return DEFAULT_EXPORT_UNIT_CODE;
}

function assertSameTotal(total: Big, amount: number): void {
  if (!total.eq(new Big(amount).round(2, Big.roundHalfUp))) {
    throw new InputValidationError(
      `La suma de los ítems (${formatArgentineAmount(roundAmount(total))}) no coincide con \`--monto\` (${formatArgentineAmount(amount)}).`,
    );
  }
}

/** Se valida antes de consultar ARCA: un total que no cierra no tiene por que autenticar en WSAA. */
export function assertExportItemsTotal(inputs: readonly ExportItemInput[] | undefined, amount: number): void {
  if (!inputs || inputs.length === 0) {
    return;
  }

  const total = inputs.reduce(
    (sum, item) => sum.plus(new Big(item.quantity).times(item.unitPrice).round(2, Big.roundHalfUp)),
    new Big(0),
  );

  assertSameTotal(total, amount);
}

/**
 * Un item sin `--item` resume el comprobante en un renglon con el total. Con items, la suma tiene que dar
 * el monto: ARCA no valida `Imp_total` contra los items, asi que se valida aca.
 */
export function buildExportItems(
  inputs: readonly ExportItemInput[] | undefined,
  amount: number,
  units: readonly ExportUnit[],
  defaultDescription: string,
): ExportItemsResult {
  if (!inputs || inputs.length === 0) {
    return {
      items: [
        {
          Pro_bonificacion: 0,
          Pro_codigo: '',
          Pro_ds: defaultDescription,
          Pro_precio_uni: amount,
          Pro_qty: 1,
          Pro_total_item: roundAmount(new Big(amount)),
          Pro_umed: DEFAULT_EXPORT_UNIT_CODE,
        },
      ],
      total: roundAmount(new Big(amount)),
    };
  }

  const items = inputs.map((item) => {
    if (!item.description.trim()) {
      throw new InputValidationError('Cada ítem necesita una descripción.');
    }

    const quantity = new Big(item.quantity);

    if (quantity.lte(0)) {
      throw new InputValidationError(`La cantidad del ítem "${item.description}" tiene que ser mayor a 0.`);
    }

    if (!(item.unitPrice > 0)) {
      throw new InputValidationError(`El precio del ítem "${item.description}" tiene que ser mayor a 0.`);
    }

    return {
      Pro_bonificacion: 0,
      Pro_codigo: item.code?.trim() ?? '',
      Pro_ds: item.description.trim(),
      Pro_precio_uni: item.unitPrice,
      Pro_qty: quantity.toNumber(),
      Pro_total_item: roundAmount(quantity.times(item.unitPrice)),
      Pro_umed: resolveUnitCode(item.unit, units),
    };
  });

  const total = items.reduce((sum, item) => sum.plus(item.Pro_total_item), new Big(0));

  assertSameTotal(total, amount);

  return { items, total: roundAmount(total) };
}
