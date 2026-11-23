import { formatExchangeRate } from '../../lib/numbers/argentine-amount';
import { DEFAULT_CURRENCY_CODE } from '../billing/billing.constants';
import { formatMoneyLabel } from '../billing/billing.labels';
import { DEFAULT_EXPORT_ITEM_DESCRIPTION, sumExportItems } from '../export/export.items';
import {
  DEFAULT_EXPORT_UNIT_CODE,
  type ExportItemInput,
  type ExportUnit,
  type ExportVoucherInput,
} from '../export/export.types';

import { applyRowEdits, type RowEdits } from './row-marks';
import { amountCurrencyCode } from './steps/amount';

/**
 * Los items de la E en el asistente (NAV-10): siempre al menos uno, porque ARCA lo exige, y el total es su suma. El
 * primero arranca con "Según detalle", 1 y "unidades" (7): con solo el precio queda el renglon que el CLI arma sin
 * `--item`.
 */
export const FIRST_EXPORT_ITEM_DEFAULTS = {
  description: DEFAULT_EXPORT_ITEM_DESCRIPTION,
  quantity: 1,
  unit: DEFAULT_EXPORT_UNIT_CODE,
} as const;

/** Un renglon por el total, como el que arma el CLI sin `--item`. */
export function summaryExportItem(total: number): ExportItemInput {
  return { ...FIRST_EXPORT_ITEM_DEFAULTS, unitPrice: total };
}

/**
 * El total de la E que arma el asistente: la suma de los items, cada renglon redondeado a dos decimales como los suma
 * el CLI (`sumExportItems`). Asi `--monto` y los `--item` del comando equivalente cierran por construccion (1610).
 * Sin items todavia, no hay total.
 *
 * @internal Exportado para los tests.
 */
export function exportItemsTotal(items: readonly ExportItemInput[] | undefined): number | undefined {
  return items && items.length > 0 ? sumExportItems(items) : undefined;
}

/**
 * Un solo renglon sin codigo, con cantidad 1, unidades (7) y el total como precio: es el que arma el CLI sin `--item`
 * (`buildExportItems`), asi que la forma rapida `-m <total> --descripcion` le manda a ARCA lo mismo.
 */
function isSummaryItem(item: ExportItemInput, total: number): boolean {
  return (
    !item.code?.trim() &&
    item.quantity === 1 &&
    (item.unit ?? DEFAULT_EXPORT_UNIT_CODE) === DEFAULT_EXPORT_UNIT_CODE &&
    item.unitPrice === total
  );
}

/**
 * Los items como van en la entrada del CLI (y en el comando equivalente): el monto es su suma y, si son un solo renglon
 * por el total, la forma rapida, con `--descripcion` (sin ella si es "Según detalle", la del CLI por defecto). Si no,
 * un `--item` por renglon.
 */
export function exportItemsEntry(
  items: readonly ExportItemInput[] | undefined,
): Pick<ExportVoucherInput, 'amount' | 'description' | 'items'> {
  const amount = exportItemsTotal(items);

  if (items?.length === 1) {
    const [only] = items as readonly [ExportItemInput];

    if (isSummaryItem(only, sumExportItems(items))) {
      const description = only.description.trim();

      return { amount, description: description === DEFAULT_EXPORT_ITEM_DESCRIPTION ? undefined : description };
    }
  }

  return { amount, items };
}

/** Como se ve un item en el editor: la descripcion, cantidad, unidad y precio, y su total. */
export interface ExportItemRow {
  readonly title: string;
  readonly detail: string;
  readonly total: string;
}

/** El nombre de la unidad en la tabla de WSFEX; si no esta (o es un nombre), lo que vino. */
function unitName(unit: ExportItemInput['unit'], units: readonly ExportUnit[]): string {
  const code = unit ?? DEFAULT_EXPORT_UNIT_CODE;

  if (typeof code === 'string') {
    return code;
  }

  return units.find((entry) => entry.id === code)?.name.trim() || `unidad ${code}`;
}

/**
 * La cantidad y el precio unitario aceptan hasta seis decimales (`--item`): se muestran todos, no redondeados a dos
 * como un importe.
 */
function preciseNumber(value: number): string {
  return formatExchangeRate(value);
}

function unitPriceLabel(value: number, currencyCode: string): string {
  const code = amountCurrencyCode(currencyCode);

  return code === DEFAULT_CURRENCY_CODE ? `$ ${preciseNumber(value)}` : `${preciseNumber(value)} ${code}`;
}

/** "Jugo de naranja", "100 litros x 2,50 USD" y "250 USD". */
export function describeExportItem(
  item: ExportItemInput,
  units: readonly ExportUnit[],
  currencyCode: string,
): ExportItemRow {
  return {
    detail: `${preciseNumber(item.quantity)} ${unitName(item.unit, units)} x ${unitPriceLabel(item.unitPrice, currencyCode)}`,
    title: item.description.trim(),
    total: formatMoneyLabel(sumExportItems([item]), currencyCode),
  };
}

/**
 * Lo que hace Enter en el editor: los items sin los borrados y, de esos, cuales se vuelven a preguntar (posicion en la
 * lista nueva). Nunca deja la lista vacia: si las marcas borrarian todo, no borra nada (el editor ya no lo permite).
 */
export function applyExportItemEdits(
  items: readonly ExportItemInput[],
  edits: Pick<RowEdits, 'edit' | 'remove'>,
): { readonly edit: number[]; readonly items: ExportItemInput[] } {
  const applied = applyRowEdits(items, edits);

  if (applied.rows.length === 0) {
    return { edit: [...edits.edit], items: [...items] };
  }

  return { edit: applied.edit, items: applied.rows };
}
