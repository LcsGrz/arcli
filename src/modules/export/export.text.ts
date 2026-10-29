import {
  contentPanel,
  keyValuePanel,
  renderKeyValueRows,
  renderObject,
  renderTable,
  resolveKeyValueLabelWidth,
  statusPanel,
  testingBanner,
  toneText,
} from '../../ui';
import { formatDateLabel, formatMoneyLabel, formatNumericLabel } from '../billing/billing.labels';

import { formatRawExportResponse } from './export.serialize';
import { EXPORT_TYPES, type ExportExecutionResult } from './export.types';

export interface ExportTextOptions {
  readonly environment?: 'produccion' | 'testing';
  readonly previewShown?: boolean;
  readonly raw?: boolean;
}

type Rows = Array<readonly [string, string]>;

function formatEnvironmentBanner(environment: ExportExecutionResult['environment'] | undefined): string[] {
  return environment === 'testing' ? [testingBanner()] : [];
}

export function formatExportStatusBadge(result: ExportExecutionResult): {
  readonly label: string;
  readonly tone: 'danger' | 'success' | 'warning';
} {
  switch (result.response.status) {
    case 'aprobado':
      return { label: 'APROBADO', tone: 'success' };
    case 'rechazado':
      return { label: 'RECHAZADO', tone: 'danger' };
    default:
      return { label: 'OBSERVADO', tone: 'warning' };
  }
}

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
    return 'No informado';
  }

  return description ? `${code} - ${description}` : code;
}

function formatCurrency(result: ExportExecutionResult): string {
  const { CanMisMonExt: sameCurrency, Moneda_Id: currency, Moneda_ctz: rate } = result.payload;
  const label = currency === 'PES' ? `${currency} (pesos)` : `${currency}, cotizacion ${rate}`;

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
    formatMoneyLabel(item.Pro_total_item),
  ]);
  const labelWidth = Math.max(...rows.map(([label]) => label.length), 0);

  return renderTable(rows, { labelWidth }).trimEnd();
}

function formatPayloadRows(result: ExportExecutionResult): Rows {
  const { payload } = result;
  const rows: Rows = [
    ['Cliente', payload.Cliente],
    ['CUIT del pais del cliente', String(payload.Cuit_pais_cliente)],
    ['Domicilio del cliente', payload.Domicilio_cliente],
    ['Pais de destino', formatCountry(result)],
    ['Tipo de exportacion', formatExportType(result)],
    ['Actividad', payload.Actividades.Actividad.map((activity) => activity.Id).join(', ')],
    ['Incoterm', formatIncoterm(result)],
    ['Idioma', result.display.languageName ?? String(payload.Idioma_cbte)],
    ['Moneda', formatCurrency(result)],
    ['Forma de pago', payload.Forma_pago],
    ['Punto de venta', formatNumericLabel(payload.Punto_vta)],
    ['Numero', formatNumericLabel(payload.Cbte_nro)],
    ['Fecha del comprobante', formatDateLabel(payload.Fecha_cbte)],
    ['Fecha de pago', formatDateLabel(payload.Fecha_pago)],
    ['Importe total', formatMoneyLabel(payload.Imp_total)],
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

export function formatExportPayloadPreview(result: ExportExecutionResult): string {
  const content = [formatExportPayloadTable(result)];
  const items = formatItemsTable(result);

  if (items) {
    content.push(items);
  }

  const footer = result.dryRun ? toneText('SIN EMITIR', 'warning') : undefined;

  return keyValuePanel(result.voucherKind.displayName, content, footer, 'ticket', undefined, 'ticket');
}

export function formatExportResultPanel(
  result: ExportExecutionResult,
  status: { readonly label: string; readonly tone: 'danger' | 'success' | 'warning' },
): string {
  const summaryRows: Array<readonly [string, string | number]> = [
    ['CAE', result.response.cae ?? 'N/D'],
    ['Vencimiento CAE', formatDateLabel(result.response.caeVencimiento ?? undefined)],
    ['Punto de venta', result.payload.Punto_vta],
    ['Numero', result.payload.Cbte_nro],
    ['Importe total', formatMoneyLabel(result.payload.Imp_total)],
  ];
  const countRows: Array<readonly [string, string | number]> = [
    ['Observaciones', result.response.observaciones.length],
    ['Eventos', result.response.events.length],
    ['Errores', result.response.errors.length],
  ];
  const labelWidth = resolveKeyValueLabelWidth('ticket', [...summaryRows, ...countRows]);
  const rows = [
    ...renderKeyValueRows(summaryRows, { labelWidth }),
    '',
    ...renderKeyValueRows(countRows, { labelWidth }),
  ];

  return statusPanel(
    result.voucherKind.displayName,
    rows,
    toneText(status.label, status.tone),
    'ticket',
    status.tone,
    'ticket',
  );
}

function formatObservationList(observaciones: readonly string[]): string {
  return observaciones.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

function formatWarningsPanel(result: ExportExecutionResult): string[] {
  const warnings = result.warnings ?? [];

  if (warnings.length === 0) {
    return [];
  }

  return [
    contentPanel('Avisos', warnings.map((item) => `• ${item}`).join('\n'), 'wide', 'warning', 'left', 'attention'),
  ];
}

export function formatExportResultAsText(result: ExportExecutionResult, options: ExportTextOptions = {}): string {
  const environmentLines = [
    ...(options.previewShown ? [] : formatEnvironmentBanner(options.environment ?? result.environment)),
    ...(options.previewShown ? [] : formatWarningsPanel(result)),
  ];

  if (result.dryRun) {
    return [...environmentLines, formatExportPayloadPreview(result)].join('\n\n');
  }

  const lines = [...environmentLines];

  if (!options.previewShown) {
    lines.push(formatExportPayloadPreview(result));
  }

  lines.push(formatExportResultPanel(result, formatExportStatusBadge(result)));

  if (result.response.observaciones.length > 0) {
    lines.push(
      contentPanel(
        'Observaciones',
        formatObservationList(result.response.observaciones),
        'wide',
        'warning',
        'left',
        'attention',
      ),
    );
  }

  if (result.response.events.length > 0) {
    lines.push(contentPanel('Eventos', renderObject(result.response.events), 'wide', 'subtle', 'left', 'data'));
  }

  if (result.response.errors.length > 0) {
    lines.push(contentPanel('Errores', renderObject(result.response.errors), 'wide', 'danger', 'left', 'error'));
  }

  if (result.response.suggestions.length > 0) {
    lines.push(
      contentPanel(
        'Sugerencias',
        result.response.suggestions.map((item) => `• ${item}`).join('\n'),
        'wide',
        'warning',
        'left',
        'tip',
      ),
    );
  }

  // `--bruto` agrega la respuesta cruda al final; el resumen se muestra igual.
  if (options.raw) {
    lines.push(
      contentPanel('Respuesta bruta', renderObject(formatRawExportResponse(result)), 'wide', 'subtle', 'left', 'data'),
    );
  }

  return lines.join('\n\n');
}
