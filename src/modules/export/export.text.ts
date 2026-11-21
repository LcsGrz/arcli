import { formatCuit } from '../../lib/identity/format-cuit';
import { formatExchangeRate } from '../../lib/numbers/argentine-amount';
import {
  padEndVisible,
  padStartVisible,
  panelContentWidth,
  renderKeyValueRows,
  resolveKeyValueLabelWidth,
  stacksAtColumn,
  visibleWidth,
  wrapPlainText,
} from '../../ui/primitives';
import { UI_THEME } from '../../ui/theme';
import { formatCurrencyLabel, formatDateLabel, formatMoneyLabel } from '../billing/billing.labels';
import { formatVoucherText, type VoucherTextOptions } from '../billing/voucher-text';
import { formatVoucherNumber } from '../vouchers/voucher-history.presenter';

import { formatRawExportResponse } from './export.serialize';
import { EXPORT_TYPES, type ExportExecutionResult, type ExportPermitCheckStatus } from './export.types';

export type ExportTextOptions = VoucherTextOptions;

type Rows = Array<readonly [string, string]>;

/** `invalido` no llega a la vista previa: corta antes con un error. */
const PERMIT_STATUS_LABELS: Record<ExportPermitCheckStatus, string> = {
  invalido: 'ARCA no lo reconoce',
  'sin-verificar': 'sin verificar',
  valido: 'válido en ARCA',
};

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

/** La sangria de un valor apilado debajo de su etiqueta (`wrapPanelLines`). */
const STACKED_VALUE_INDENT = '  ';

/**
 * Un renglon por item, con la cantidad y la unidad en la descripcion (es lo que WSFEX autoriza) y el importe en la
 * columna de valores del comprobante, alineado a la derecha con el importe total (`amountWidth`). La descripcion va en
 * la columna de las etiquetas (`labelWidth`) y, si es larga, se parte dentro de ella. Si las filas del comprobante ya
 * se apilan en esta terminal, cada item va como ellas: la descripcion arriba y el importe debajo, con sangria.
 */
function formatItemLines(
  result: ExportExecutionResult,
  { amountWidth, labelWidth }: { amountWidth: number; labelWidth: number },
): string[] {
  const rows = formatItemRows(result);
  const width = panelContentWidth('ticket');
  const gap = ' '.repeat(UI_THEME.table.gap);

  if (stacksAtColumn(labelWidth + gap.length, width)) {
    // Como las filas apiladas del panel: la descripcion arriba y el importe debajo, con la sangria de los valores.
    return rows.flatMap((row) => [...wrapPlainText(row.description, width), `${STACKED_VALUE_INDENT}${row.amount}`]);
  }

  return rows.flatMap((row) => {
    const [first = '', ...rest] = wrapPlainText(row.description, labelWidth);

    return [`${padEndVisible(first, labelWidth)}${gap}${padStartVisible(row.amount, amountWidth)}`, ...rest];
  });
}

function formatItemRows(result: ExportExecutionResult): Array<{ amount: string; description: string }> {
  return result.payload.Items.Item.map((item) => ({
    amount: formatAmount(result, item.Pro_total_item),
    description: `${item.Pro_qty} x ${item.Pro_ds} (${formatUnit(result, item.Pro_umed)})`.replace(/\s+/g, ' '),
  }));
}

/** "Factura de exportación E 00003-00000012 del 05/11/2026, USD 1.500,00": lo que ajusta la nota. */
function formatAssociatedVoucher(result: ExportExecutionResult): string | undefined {
  const associated = result.payload.Cmps_asoc?.Cmp_asoc[0];
  const display = result.display.associatedVoucher;

  if (!associated) {
    return undefined;
  }

  const number = formatVoucherNumber(associated.Cbte_punto_vta, associated.Cbte_nro);

  return display
    ? `${display.displayName} ${number} del ${formatDateLabel(display.date)}, ${formatMoneyLabel(display.total, display.currencyCode)}`
    : `Tipo ${associated.Cbte_tipo} ${number}`;
}

/** El permiso con lo que contesto ARCA en la vista previa, si se consulto. */
function formatPermit(result: ExportExecutionResult, permit: string): string {
  const status = result.display.permitChecks?.find((check) => check.permit === permit)?.status;

  if (!status) {
    return permit;
  }

  // Testing contesta OK a cualquier permiso: decir "valido" ahi seria prometer algo que ARCA no miro.
  const label =
    status === 'valido' && result.environment === 'testing' ? 'OK en testing' : PERMIT_STATUS_LABELS[status];

  return `${permit} (${label})`;
}

function formatPayloadRows(result: ExportExecutionResult): Rows {
  const { payload } = result;
  const associated = formatAssociatedVoucher(result);
  const rows: Rows = [
    ...(associated ? [['Comprobante asociado', associated] as const] : []),
    ['Cliente', payload.Cliente],
    ...(payload.Cuit_pais_cliente === undefined
      ? []
      : [['CUIT del país del cliente', formatCuit(payload.Cuit_pais_cliente)] as const]),
    ['Domicilio del cliente', payload.Domicilio_cliente],
    ['País de destino', formatCountry(result)],
    ['Tipo de exportación', formatExportType(result)],
    ...(payload.Actividades
      ? [['Actividad', payload.Actividades.Actividad.map((activity) => activity.Id).join(', ')] as const]
      : []),
    ['Incoterm', formatIncoterm(result)],
    ['Idioma', formatLanguage(result)],
    ['Moneda', formatCurrency(result)],
    ['Forma de pago', payload.Forma_pago],
  ];

  if (payload.Id_impositivo) {
    // Despues del domicilio, con o sin la fila del CUIT del pais.
    rows.splice(rows.findIndex(([label]) => label === 'Domicilio del cliente') + 1, 0, [
      'ID impositivo del cliente',
      payload.Id_impositivo,
    ]);
  }

  const permits = payload.Permisos?.Permiso ?? [];

  if (permits.length > 0) {
    rows.push(['Permisos de embarque', permits.map((permit) => formatPermit(result, permit.Id_permiso)).join(', ')]);
  }

  if (payload.Obs) {
    rows.push(['Observaciones', payload.Obs]);
  }

  if (payload.Obs_comerciales) {
    rows.push(['Observaciones comerciales', payload.Obs_comerciales]);
  }

  // Las fechas al final del bloque: abajo van los items y, al pie, el importe total (TUI-16).
  rows.push(
    ['Número', formatVoucherNumber(payload.Punto_vta, payload.Cbte_nro)],
    ['Fecha del comprobante', formatDateLabel(payload.Fecha_cbte)],
    ...(payload.Fecha_pago ? [['Fecha de pago', formatDateLabel(payload.Fecha_pago)] as const] : []),
  );

  return rows;
}

const totalRow = (result: ExportExecutionResult): Rows[number] => [
  'Importe total',
  formatAmount(result, result.payload.Imp_total),
];

/**
 * Los datos del comprobante hasta las fechas, una linea en blanco, los items y, pegado abajo, el importe total: su
 * etiqueta en negrita lo separa de los items. Los importes de los items y el total van en la columna de valores de los
 * datos, alineados a la derecha entre si.
 */
function formatExportPreviewContent(result: ExportExecutionResult): string[] {
  const rows = formatPayloadRows(result);
  const [totalLabel, totalAmount] = totalRow(result);
  const labelWidth = resolveKeyValueLabelWidth('ticket', [...rows, [totalLabel]]);
  const amountWidth = Math.max(
    visibleWidth(totalAmount),
    ...formatItemRows(result).map((row) => visibleWidth(row.amount)),
  );
  const items = formatItemLines(result, { amountWidth, labelWidth });

  return [
    ...renderKeyValueRows(rows, { labelWidth }),
    '',
    ...items,
    ...renderKeyValueRows([[totalLabel, padStartVisible(totalAmount, amountWidth)]], { labelWidth }),
  ];
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
