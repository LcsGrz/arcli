import Big from 'big.js';

import { InputValidationError } from '../../lib/errors/app-error';
import { formatArgentineAmount, parseArgentineAmount } from '../../lib/numbers/argentine-amount';
import { assertRules } from '../../lib/rules/rules';
import { roundAmount } from '../billing/billing.amounts';

import type { ExportRule } from './export.rules';
import {
  DEFAULT_EXPORT_UNIT_CODE,
  EXPORT_TOTAL_ONLY_UNIT_CODES,
  type ExportItemInput,
  type ExportItemPayload,
  type ExportUnit,
} from './export.types';

export const DEFAULT_EXPORT_ITEM_DESCRIPTION = 'Según detalle';

/** Largos maximos del item: codigo (1760) y descripcion (1770), WSFEX v3.1.0. */
const MAX_EXPORT_ITEM_CODE_LENGTH = 50;
export const MAX_EXPORT_ITEM_DESCRIPTION_LENGTH = 4000;

/** Cantidad de caracteres como los cuenta ARCA, no unidades UTF-16: un emoji es uno. */
function textLength(value: string): number {
  return [...value].length;
}

/** El error de un texto mas largo que lo que acepta ARCA, o `undefined` si entra. */
export function exportTextLengthError(options: {
  readonly code?: number;
  readonly label: string;
  readonly max: number;
  readonly value: string | undefined;
}): string | undefined {
  const length = textLength(options.value?.trim() ?? '');

  if (length <= options.max) {
    return undefined;
  }

  return `${options.label} no puede tener más de ${formatArgentineAmount(options.max)} caracteres y tiene ${formatArgentineAmount(length)}: ARCA lo rechaza${options.code === undefined ? '' : ` (error ${options.code})`}.`;
}

/**
 * Codigo y descripcion de cada item, antes de ir a ARCA: la descripcion hasta 4000 caracteres (1770, WSFEX v3.1.0).
 * El codigo hasta 50 es propio: el manual lo pone como control (1760), pero ARCA testing aprobo uno de 51 (19-4-22 y
 * 19-4-23 del 19/11/2026). Se deja como en el manual porque produccion puede aplicarlo.
 */
export function assertExportItemTexts(inputs: readonly ExportItemInput[] | undefined): void {
  for (const item of inputs ?? []) {
    const error =
      exportTextLengthError({
        code: 1760,
        label: `El código del ítem "${item.code ?? ''}"`,
        max: MAX_EXPORT_ITEM_CODE_LENGTH,
        value: item.code,
      }) ??
      exportTextLengthError({
        code: 1770,
        label: 'La descripción de un ítem',
        max: MAX_EXPORT_ITEM_DESCRIPTION_LENGTH,
        value: item.description,
      });

    if (error) {
      throw new InputValidationError(error);
    }
  }
}

/**
 * 1775 (WSFEX v3.1.0): con las unidades 0, 97 (sena o anticipo) y 99 (bonificacion) ARCA pide cantidad y precio en 0.
 * ARCLI pide cantidad y precio mayores a 0, asi que no las acepta.
 */
function assertNotTotalOnlyUnit(unit: number, description: string): void {
  if (EXPORT_TOTAL_ONLY_UNIT_CODES.includes(unit)) {
    throw new InputValidationError(
      `La unidad ${unit} del ítem "${description}" va sin cantidad ni precio y ARCLI todavía no la acepta: ARCA rechaza un ítem así con cantidad y precio (error 1775). Usá otra unidad.`,
    );
  }
}
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

/**
 * La unidad del item puede ser el codigo de ARCA (`7`) o el nombre de la tabla (`unidad`). Llega ya recortada
 * y no vacia: `parseExportItemArgument` usa la unidad por defecto cuando la parte falta o esta en blanco.
 */
function resolveExportItemUnit(unit: string): string | number {
  return /^\d+$/.test(unit) ? Number(unit) : unit;
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

function sumItems(inputs: readonly ExportItemInput[]): Big {
  return inputs.reduce(
    (sum, item) => sum.plus(new Big(item.quantity).times(item.unitPrice).round(2, Big.roundHalfUp)),
    new Big(0),
  );
}

/** Suma de los items como la valida el CLI: cada renglon redondeado a dos decimales. */
export function sumExportItems(inputs: readonly ExportItemInput[]): number {
  return roundAmount(sumItems(inputs));
}

/**
 * Con items, la suma (cada renglon redondeado a dos decimales) da el monto total: 1610, WSFEX v3.1.0. Sin items va un
 * renglon con el total. En el asistente los items son un bucle propio que solo termina cuando suman el monto (NAV-3).
 */
export const EXPORT_ITEMS_TOTAL_RULE: ExportRule = {
  check: ({ amount, items }) => {
    if (!items?.length || typeof amount !== 'number') {
      return undefined;
    }

    const total = sumItems(items);

    if (total.eq(new Big(amount).round(2, Big.roundHalfUp))) {
      return undefined;
    }

    const sum = formatArgentineAmount(roundAmount(total));

    return {
      message: `La suma de los ítems (${sum}) no coincide con \`--monto\` (${formatArgentineAmount(amount)}).`,
      question: `La suma de los ítems (${sum}) no coincide con el monto total (${formatArgentineAmount(amount)}).`,
    };
  },
  fields: ['items'],
  id: 'export-items-total',
};

/** Se valida antes de consultar ARCA: un total que no cierra no tiene por que autenticar en WSAA. */
export function assertExportItemsTotal(inputs: readonly ExportItemInput[] | undefined, amount: number): void {
  assertRules([EXPORT_ITEMS_TOTAL_RULE], { amount, items: inputs }, {});
}

/**
 * Un item sin `--item` resume el comprobante en un renglon con el total. Con items, la suma tiene que dar
 * el monto, y se valida aca. El manual WSFEX v3.1.0 si lo pone como control (1610).
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

    const unit = resolveUnitCode(item.unit, units);

    assertNotTotalOnlyUnit(unit, item.description.trim());

    return {
      Pro_bonificacion: 0,
      Pro_codigo: item.code?.trim() ?? '',
      Pro_ds: item.description.trim(),
      Pro_precio_uni: item.unitPrice,
      Pro_qty: quantity.toNumber(),
      Pro_total_item: roundAmount(quantity.times(item.unitPrice)),
      Pro_umed: unit,
    };
  });

  assertExportItemsTotal(inputs, amount);

  const total = items.reduce((sum, item) => sum.plus(item.Pro_total_item), new Big(0));

  return { items, total: roundAmount(total) };
}
