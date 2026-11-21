import { sumExportItems } from '../export/export.items';
import {
  DEFAULT_EXPORT_LANGUAGE,
  EXPORT_TOTAL_ONLY_UNIT_CODES,
  type ExportIssuedItem,
  type ExportIssuedVoucher,
  type ExportItemInput,
  type ExportVoucherInput,
} from '../export/export.types';

import { summaryExportItem } from './export-items';

/**
 * Lo que se copia de una factura E para repetirla: cliente, destino, moneda, incoterm, forma de pago, idioma y
 * actividad. Los items, con `copyExportItems`. Las fechas, la cotizacion (sale la de hoy), los permisos de embarque y
 * las observaciones no.
 */
export interface ExportInvoiceCopy {
  readonly input: Pick<
    ExportVoucherInput,
    | 'activity'
    | 'clientAddress'
    | 'clientCountryCuit'
    | 'clientName'
    | 'clientTaxId'
    | 'currencyCode'
    | 'exportType'
    | 'incoterm'
    | 'incotermDescription'
    | 'language'
    | 'paymentTerms'
    | 'sameCurrency'
  >;
  /** Por que los items no se copian tal cual; sin motivo, se copian. */
  readonly limitation?: string;
}

/** Los items con los que arranca el editor de "Repetir" o de una nota E: siempre al menos uno. */
export interface ExportItemsCopy {
  readonly items: readonly ExportItemInput[];
  /** Por que no son los del comprobante y arranca con un renglon por el total. */
  readonly limitation?: string;
}

/** Por que los items del comprobante no se pueden copiar tal cual, o `undefined` si se puede. */
function itemsLimitation(items: readonly ExportIssuedItem[], total: number): string | undefined {
  if (items.some((item) => item.discount !== 0)) {
    return 'El comprobante tiene ítems con bonificación, que el asistente no informa: sale un renglón con el monto total.';
  }

  // 1775: las unidades 0, 97 y 99 van sin cantidad ni precio, y ARCLI todavia no las acepta.
  if (items.some((item) => EXPORT_TOTAL_ONLY_UNIT_CODES.includes(item.unit))) {
    return 'El comprobante tiene ítems de seña, anticipo o bonificación (unidades 97 y 99), que el asistente no informa: sale un renglón con el monto total.';
  }

  if (sumExportItems(copiedItems(items)) !== total) {
    return 'Los ítems del comprobante no suman su total: sale un renglón con el monto total.';
  }

  return undefined;
}

function copiedItems(items: readonly ExportIssuedItem[]): ExportItemInput[] {
  return items.map((item) => ({
    code: item.code,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: item.unitPrice,
  }));
}

/**
 * Los items de una factura o nota E, para arrancar el editor (NAV-10): los mismos si se pueden informar igual y suman
 * su total; si no (bonificacion, sena o anticipo, o no suman), un renglon por el total, con el motivo. Sin items,
 * tambien un renglon por el total, sin motivo: es lo que ARCA tiene.
 */
export function copyExportItems(voucher: Pick<ExportIssuedVoucher, 'items' | 'total'>): ExportItemsCopy {
  const items = voucher.items ?? [];

  if (items.length === 0) {
    return { items: [summaryExportItem(voucher.total)] };
  }

  const limitation = itemsLimitation(items, voucher.total);

  return limitation ? { items: [summaryExportItem(voucher.total)], limitation } : { items: copiedItems(items) };
}

/**
 * Copia de una factura E para repetirla. `defaultCountryCuit` es el CUIT que la tabla de ARCA da para el destino: si
 * es el mismo que el de la factura no se repite, asi el comando equivalente no lleva un `--cuit-pais` de mas.
 */
export function copyExportInvoice(original: ExportIssuedVoucher, defaultCountryCuit?: number): ExportInvoiceCopy {
  const { limitation } = copyExportItems(original);
  const inPesos = original.currencyCode.trim().toUpperCase() === 'PES';

  return {
    input: {
      activity: original.activities[0],
      clientAddress: original.clientAddress,
      clientCountryCuit: original.clientCountryCuit === defaultCountryCuit ? undefined : original.clientCountryCuit,
      clientName: original.clientName,
      clientTaxId: original.clientTaxId,
      currencyCode: original.currencyCode,
      exportType: original.exportType,
      incoterm: original.incoterm,
      incotermDescription:
        original.incoterm && original.incotermDescription !== original.incoterm
          ? original.incotermDescription
          : undefined,
      language: original.language === DEFAULT_EXPORT_LANGUAGE ? undefined : original.language,
      paymentTerms: original.paymentTerms,
      sameCurrency: inPesos ? false : original.sameCurrency,
    },
    limitation,
  };
}
