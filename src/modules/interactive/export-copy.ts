import { sumExportItems } from '../export/export.items';
import {
  DEFAULT_EXPORT_LANGUAGE,
  DEFAULT_EXPORT_UNIT_CODE,
  type ExportIssuedItem,
  type ExportIssuedVoucher,
  type ExportVoucherInput,
} from '../export/export.types';

/**
 * Lo que se copia de una factura E para repetirla: cliente, destino, moneda, incoterm, items, forma de pago,
 * idioma y actividad. Las fechas, la cotizacion (sale la de hoy), los permisos de embarque y las observaciones no.
 */
export interface ExportInvoiceCopy {
  readonly input: Pick<
    ExportVoucherInput,
    | 'activity'
    | 'amount'
    | 'clientAddress'
    | 'clientCountryCuit'
    | 'clientName'
    | 'clientTaxId'
    | 'currencyCode'
    | 'description'
    | 'exportType'
    | 'incoterm'
    | 'incotermDescription'
    | 'items'
    | 'language'
    | 'paymentTerms'
    | 'sameCurrency'
  >;
  /** Por que los items no se copian tal cual; sin motivo, se copian. */
  readonly limitation?: string;
}

/** Un solo renglon por el total, con la unidad por defecto: es lo que arma `--descripcion` sin `--item`. */
function isSummaryLine(items: readonly ExportIssuedItem[], total: number): boolean {
  const [item] = items;

  return (
    items.length === 1 &&
    item !== undefined &&
    !item.code &&
    item.quantity === 1 &&
    item.unit === DEFAULT_EXPORT_UNIT_CODE &&
    item.unitPrice === total
  );
}

function copyItems(
  original: ExportIssuedVoucher,
): Pick<ExportInvoiceCopy['input'], 'description' | 'items'> & { readonly limitation?: string } {
  const items = original.items ?? [];

  if (items.length === 0) {
    return {};
  }

  if (items.some((item) => item.discount !== 0)) {
    return {
      limitation:
        'La factura tiene ítems con bonificación, que el asistente no informa: sale un renglón con el monto total.',
    };
  }

  if (isSummaryLine(items, original.total)) {
    return { description: items[0]?.description };
  }

  const copied = items.map((item) => ({
    code: item.code,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: item.unitPrice,
  }));

  if (sumExportItems(copied) !== original.total) {
    return {
      limitation: 'Los ítems de la factura no suman su total: sale un renglón con el monto total.',
    };
  }

  return { items: copied };
}

/**
 * Copia de una factura E para repetirla. `defaultCountryCuit` es el CUIT que la tabla de ARCA da para el destino: si
 * es el mismo que el de la factura no se repite, asi el comando equivalente no lleva un `--cuit-pais` de mas.
 */
export function copyExportInvoice(original: ExportIssuedVoucher, defaultCountryCuit?: number): ExportInvoiceCopy {
  const { limitation, ...items } = copyItems(original);
  const inPesos = original.currencyCode.trim().toUpperCase() === 'PES';

  return {
    input: {
      activity: original.activities[0],
      amount: original.total,
      clientAddress: original.clientAddress,
      clientCountryCuit: original.clientCountryCuit === defaultCountryCuit ? undefined : original.clientCountryCuit,
      clientName: original.clientName,
      clientTaxId: original.clientTaxId,
      currencyCode: original.currencyCode,
      ...items,
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
