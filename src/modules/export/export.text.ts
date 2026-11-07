import { formatCuit } from '../../lib/identity/format-cuit';
import { formatExchangeRate } from '../../lib/numbers/argentine-amount';
import { renderTable, resolveKeyValueLabelWidth } from '../../ui/primitives';
import { formatCurrencyLabel, formatDateLabel, formatMoneyLabel } from '../billing/billing.labels';
import { formatVoucherText, type VoucherTextOptions } from '../billing/voucher-text';
import { formatVoucherNumber } from '../vouchers/voucher-history.presenter';

import { formatRawExportResponse } from './export.serialize';
import { EXPORT_TYPES, type ExportExecutionResult } from './export.types';

export type ExportTextOptions = VoucherTextOptions;

type Rows = Array<readonly [string, string]>;

function formatCountry(result: ExportExecutionResult): string {
  const { Dst_cmp: code } = result.payload;
  const name = result.display.countryName;

  return name ? `${code} - ${name}` : String(code);
}

function formatExportType(result: ExportExecutionResult): string {
  return `${result.payload.Tipo_expo} - ${EXPORT_TYPES[result.payload.Tipo_expo]}`;
}

function formatIncoterm(result: ExportExecutionResult): string {
  const { Incoterms: code, Incoterms_Ds: description } = result.payload;

  if (!code) {
    return 'N/D';
  }

  // La tabla de WSFEX trae como descripcion el mismo codigo ("FOB"): no se repite.
  return description && description.trim().toUpperCase() !== code.trim().toUpperCase()
    ? `${code} - ${description}`
    : code;
}

/** La E casi siempre va en moneda extranjera: el importe lleva su codigo, no el `$` de los pesos. */
function formatAmount(result: ExportExecutionResult, value: number): string {
  return formatMoneyLabel(value, result.payload.Moneda_Id);
}

function formatLanguage(result: ExportExecutionResult): string {
  const { Idioma_cbte: id } = result.payload;

  return result.display.languageName ? `${id} - ${result.display.languageName}` : String(id);
}

function formatCurrency(result: ExportExecutionResult): string {
  const { CanMisMonExt: sameCurrency, Moneda_Id: currency, Moneda_ctz: rate } = result.payload;
  const name = formatCurrencyLabel(currency);
  const label = currency === 'PES' ? name : `${name}, cotización ${formatExchangeRate(rate)}`;

  return sameCurrency === 'S' ? `${label} (el pago se cancela en la misma moneda)` : label;
}

function formatUnit(result: ExportExecutionResult, unitCode: number): string {
  return result.display.unitNames[unitCode] ?? String(unitCode);
}

/** Un renglon por item, con la cantidad y la unidad como etiqueta: es lo que WSFEX autoriza. */
function formatItemsTable(result: ExportExecutionResult): string {
  const items = result.payload.Items.Item;

  if (items.length === 0) {
    return '';
  }

  const rows: Rows = items.map((item) => [
    `${item.Pro_qty} x ${item.Pro_ds} (${formatUnit(result, item.Pro_umed)})`,
    formatAmount(result, item.Pro_total_item),
  ]);
  const labelWidth = Math.max(...rows.map(([label]) => label.length), 0);

  return renderTable(rows, { labelWidth }).trimEnd();
}

function formatPayloadRows(result: ExportExecutionResult): Rows {
  const { payload } = result;
  const rows: Rows = [
    ['Cliente', payload.Cliente],
    ['CUIT del país del cliente', formatCuit(payload.Cuit_pais_cliente)],
    ['Domicilio del cliente', payload.Domicilio_cliente],
    ['País de destino', formatCountry(result)],
    ['Tipo de exportación', formatExportType(result)],
    ['Actividad', payload.Actividades.Actividad.map((activity) => activity.Id).join(', ')],
    ['Incoterm', formatIncoterm(result)],
    ['Idioma', formatLanguage(result)],
    ['Moneda', formatCurrency(result)],
    ['Forma de pago', payload.Forma_pago],
    ['Número', formatVoucherNumber(payload.Punto_vta, payload.Cbte_nro)],
    ['Fecha del comprobante', formatDateLabel(payload.Fecha_cbte)],
    ['Fecha de pago', formatDateLabel(payload.Fecha_pago)],
    ['Importe total', formatAmount(result, payload.Imp_total)],
  ];

  if (payload.Id_impositivo) {
    rows.splice(3, 0, ['ID impositivo del cliente', payload.Id_impositivo]);
  }

  const permits = payload.Permisos?.Permiso ?? [];

  if (permits.length > 0) {
    rows.push(['Permisos de embarque', permits.map((permit) => permit.Id_permiso).join(', ')]);
  }

  if (payload.Obs) {
    rows.push(['Observaciones', payload.Obs]);
  }

  if (payload.Obs_comerciales) {
    rows.push(['Observaciones comerciales', payload.Obs_comerciales]);
  }

  return rows;
}

export function formatExportPayloadTable(result: ExportExecutionResult): string {
  const rows = formatPayloadRows(result);

  return renderTable(rows, { labelWidth: resolveKeyValueLabelWidth('ticket', rows) }).trimEnd();
}

function formatExportPreviewContent(result: ExportExecutionResult): string[] {
  const items = formatItemsTable(result);

  return [formatExportPayloadTable(result), ...(items ? [items] : [])];
}

/** CAE, vencimiento, numero e importe: el resumen del resultado. */
function formatExportResultSummary(result: ExportExecutionResult): Array<readonly [string, string | number]> {
  return [
    ['CAE', result.response.cae ?? 'N/D'],
    ['Vencimiento CAE', formatDateLabel(result.response.caeVencimiento ?? undefined)],
    ['Número', formatVoucherNumber(result.payload.Punto_vta, result.payload.Cbte_nro)],
    ['Importe total', formatAmount(result, result.payload.Imp_total)],
  ];
}

export function formatExportResultAsText(result: ExportExecutionResult, options: ExportTextOptions = {}): string {
  return formatVoucherText(
    {
      dryRun: result.dryRun,
      environment: result.environment,
      preview: formatExportPreviewContent(result),
      raw: () => formatRawExportResponse(result),
      response: result.response,
      summary: formatExportResultSummary(result),
      title: result.voucherKind.displayName,
      warnings: result.warnings ?? [],
    },
    options,
  );
}
