import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { formatCuit } from '../../lib/identity/format-cuit';
import { formatExchangeRate } from '../../lib/numbers/argentine-amount';
import { listingPanel, noticePanel, ticketPanel } from '../../ui/components';
import { renderKeyValueRows, resolveKeyValueLabelWidth, uiSymbol } from '../../ui/primitives';
import { formatCurrencyLabel, formatMoneyLabel } from '../billing/billing.labels';
import { formatLatestVouchersTitle, formatNoVouchersEmitted } from '../billing/billing.mappers';
import { formatEnvironmentLabel } from '../config/config.schemas';
import { alignVoucherPickerRows, formatVoucherNumber } from '../vouchers/voucher-history.presenter';

import {
  EXPORT_TYPES,
  type ExportIssuedVoucher,
  type ExportVoucherKind,
  getExportVoucherKindByArcaType,
} from './export.types';

interface ExportReport {
  readonly environment: 'produccion' | 'testing';
  readonly pointOfSale: number;
  readonly voucherKind: ExportVoucherKind;
}

export interface ExportVoucherListReport extends ExportReport {
  readonly vouchers: readonly ExportIssuedVoucher[];
}

export interface ExportVoucherDetailReport extends ExportReport {
  readonly voucher: ExportIssuedVoucher;
}

/** Con la letra del comprobante en mayuscula, como en A, B y C. */
function formatAssociated(voucher: ExportIssuedVoucher): string | undefined {
  const associated = voucher.associatedVoucher;

  if (!associated) {
    return undefined;
  }

  const name = getExportVoucherKindByArcaType(associated.arcaType)?.displayName ?? `Tipo ${associated.arcaType}`;

  return `${name} ${formatVoucherNumber(associated.pointOfSale, associated.number)}`;
}

function formatListRow(voucher: ExportIssuedVoucher): string {
  return [
    formatVoucherNumber(voucher.pointOfSale, voucher.number),
    formatArcaDateAsArgentineDate(voucher.date),
    voucher.clientName.padEnd(20),
    formatMoneyLabel(voucher.total, voucher.currencyCode).padStart(16),
    voucher.cae ? `CAE ${voucher.cae}` : '',
  ]
    .join('  ')
    .trimEnd();
}

/** Filas para elegir un comprobante E en el modo interactivo: numero, fecha, cliente, total y CAE. */
export function formatExportVoucherPickerRows(
  vouchers: readonly ExportIssuedVoucher[],
  separator: string,
  width?: number,
): string[] {
  return alignVoucherPickerRows(
    vouchers.map((voucher) => ({
      cae: voucher.cae ? `CAE ${voucher.cae}` : '',
      date: formatArcaDateAsArgentineDate(voucher.date),
      number: formatVoucherNumber(voucher.pointOfSale, voucher.number),
      receiver: voucher.clientName,
      total: formatMoneyLabel(voucher.total, voucher.currencyCode),
    })),
    separator,
    width,
  );
}

export function formatExportVoucherListAsText(report: ExportVoucherListReport): string {
  const { pointOfSale, voucherKind, vouchers } = report;

  if (vouchers.length === 0) {
    return noticePanel(`${formatNoVouchersEmitted(voucherKind)} en el punto de venta ${pointOfSale}.`, 'muted');
  }

  const separator = uiSymbol('separator');

  return listingPanel(
    `${formatLatestVouchersTitle(voucherKind)} ${separator} PV ${pointOfSale} ${separator} ${formatEnvironmentLabel(report.environment)}`,
    vouchers.map(formatListRow),
  );
}

export function formatExportVoucherDetailAsText(report: ExportVoucherDetailReport): string {
  const { voucher, voucherKind } = report;
  const associated = formatAssociated(voucher);
  const rows: Array<readonly [string, string]> = [
    ['Número', formatVoucherNumber(voucher.pointOfSale, voucher.number)],
    ['Fecha del comprobante', formatArcaDateAsArgentineDate(voucher.date)],
    ...(associated ? [['Comprobante asociado', associated] as const] : []),
    ['Cliente', voucher.clientName],
    ['Domicilio del cliente', voucher.clientAddress],
    ...(voucher.clientTaxId ? [['ID impositivo del cliente', voucher.clientTaxId] as const] : []),
    ...(voucher.clientCountryCuit
      ? [['CUIT del país del cliente', formatCuit(voucher.clientCountryCuit)] as const]
      : []),
    ['País de destino', String(voucher.destinationCountry)],
    ['Tipo de exportación', `${voucher.exportType} - ${EXPORT_TYPES[voucher.exportType]}`],
    [
      'Moneda',
      voucher.currencyCode === 'PES'
        ? formatCurrencyLabel(voucher.currencyCode)
        : `${formatCurrencyLabel(voucher.currencyCode)}, cotización ${formatExchangeRate(voucher.exchangeRate)}`,
    ],
    ['Importe total', formatMoneyLabel(voucher.total, voucher.currencyCode)],
    ['CAE', voucher.cae ?? 'N/D'],
    ...(voucher.caeExpiration
      ? [['Vencimiento CAE', formatArcaDateAsArgentineDate(voucher.caeExpiration)] as const]
      : []),
  ];

  return ticketPanel(
    voucherKind.displayName,
    renderKeyValueRows(rows, { labelWidth: resolveKeyValueLabelWidth('ticket', rows) }),
    {
      footer: voucher.result === 'A' ? 'APROBADO' : voucher.result === 'R' ? 'RECHAZADO' : undefined,
      tone: voucher.result === 'R' ? 'danger' : 'success',
    },
  );
}

function serializeKind(voucherKind: ExportVoucherKind): Record<string, unknown> {
  return { atajo: voucherKind.shortcut, comprobante: voucherKind.displayName, tipoArca: voucherKind.arcaType };
}

/** Con las mismas claves que `exportacion` del JSON al emitir, donde coinciden. */
function serializeVoucher(voucher: ExportIssuedVoucher): Record<string, unknown> {
  const associated = voucher.associatedVoucher;

  return {
    actividad: voucher.activities,
    cae: voucher.cae ?? null,
    caeVencimiento: voucher.caeExpiration ?? null,
    cliente: voucher.clientName,
    comprobanteAsociado: associated
      ? {
          atajo: getExportVoucherKindByArcaType(associated.arcaType)?.shortcut ?? null,
          numero: associated.number,
          puntoVenta: associated.pointOfSale,
          tipoArca: associated.arcaType,
        }
      : null,
    cotizacion: voucher.exchangeRate,
    cuitPaisCliente: voucher.clientCountryCuit ?? null,
    destino: { codigo: voucher.destinationCountry },
    domicilioCliente: voucher.clientAddress,
    fecha: voucher.date,
    idImpositivo: voucher.clientTaxId ?? null,
    moneda: voucher.currencyCode,
    numero: voucher.number,
    resultado: voucher.result ?? null,
    tipoExpo: voucher.exportType,
    total: voucher.total,
  };
}

export function formatExportVoucherListAsJson(report: ExportVoucherListReport): string {
  return JSON.stringify(
    {
      ...serializeKind(report.voucherKind),
      comprobantes: report.vouchers.map(serializeVoucher),
      entorno: report.environment,
      puntoVenta: report.pointOfSale,
    },
    null,
    2,
  );
}

export function formatExportVoucherDetailAsJson(report: ExportVoucherDetailReport): string {
  return JSON.stringify(
    {
      ...serializeKind(report.voucherKind),
      ...serializeVoucher(report.voucher),
      entorno: report.environment,
      puntoVenta: report.pointOfSale,
    },
    null,
    2,
  );
}
