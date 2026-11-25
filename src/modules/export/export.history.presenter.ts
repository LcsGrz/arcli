import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { formatCuit } from '../../lib/identity/format-cuit';
import { formatExchangeRate } from '../../lib/numbers/argentine-amount';
import { listingPanel, noticePanel, ticketPanel } from '../../ui/components';
import { renderKeyValueRows, resolveKeyValueLabelWidth, uiSymbol } from '../../ui/primitives';
import { formatCurrencyLabel, formatMoneyLabel, MISSING_CAE_TEXT } from '../billing/billing.labels';
import { ARCA_LOCAL_CURRENCY_CODE } from '../billing/currency-codes';
import { formatLatestVouchersTitle, formatNoVouchersEmitted } from '../billing/voucher-names';
import { formatEnvironmentLabel } from '../config/config.schemas';
import type { ListedVoucher } from '../vouchers/voucher-history';
import {
  alignVoucherPickerRows,
  formatListColumns,
  formatUnreadableRow,
  formatUnreadableVouchers,
  serializeUnreadable,
  type VoucherPickerColumns,
} from '../vouchers/voucher-history.presenter';
import { formatVoucherNumber } from '../vouchers/voucher-number';

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
  readonly vouchers: ReadonlyArray<ListedVoucher<ExportIssuedVoucher>>;
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

function voucherColumns(voucher: ExportIssuedVoucher): VoucherPickerColumns {
  return {
    cae: voucher.cae ? `CAE ${voucher.cae}` : '',
    date: formatArcaDateAsArgentineDate(voucher.date),
    number: formatVoucherNumber(voucher.pointOfSale, voucher.number),
    receiver: voucher.clientName,
    total: formatMoneyLabel(voucher.total, voucher.currencyCode),
  };
}

/** Filas para elegir un comprobante E en el modo interactivo: numero, fecha, cliente, total y CAE. */
export function formatExportVoucherPickerRows(
  vouchers: readonly ExportIssuedVoucher[],
  separator: string,
  width?: number,
): string[] {
  return alignVoucherPickerRows(vouchers.map(voucherColumns), separator, width);
}

export function formatExportVoucherListAsText(report: ExportVoucherListReport): string {
  const { pointOfSale, voucherKind, vouchers } = report;

  if (vouchers.length === 0) {
    return noticePanel(`${formatNoVouchersEmitted(voucherKind)} en el punto de venta ${pointOfSale}.`, 'muted');
  }

  const separator = uiSymbol('separator');

  const listing = listingPanel(
    `${formatLatestVouchersTitle(voucherKind)} ${separator} PV ${pointOfSale} ${separator} ${formatEnvironmentLabel(report.environment)}`,
    vouchers.map((voucher) =>
      voucher.unreadable ? formatUnreadableRow(pointOfSale, voucher) : formatListColumns(voucherColumns(voucher)),
    ),
  );

  return [listing, formatUnreadableVouchers(pointOfSale, vouchers)].filter(Boolean).join('\n\n');
}

/** La moneda, con la cotizacion si no es en pesos. Sin moneda, la fila no va. */
function formatCurrencyRow(voucher: ExportIssuedVoucher): string | undefined {
  const name = formatCurrencyLabel(voucher.currencyCode);

  if (!name || voucher.currencyCode === ARCA_LOCAL_CURRENCY_CODE) {
    return name;
  }

  return `${name}, cotización ${formatExchangeRate(voucher.exchangeRate)}`;
}

export function formatExportVoucherDetailAsText(report: ExportVoucherDetailReport): string {
  const { voucher, voucherKind } = report;
  const associated = formatAssociated(voucher);
  const rows: Array<readonly [string, string | undefined]> = [
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
    ['Moneda', formatCurrencyRow(voucher)],
    ['Importe total', formatMoneyLabel(voucher.total, voucher.currencyCode)],
    ['CAE', voucher.cae || MISSING_CAE_TEXT],
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

export function serializeExportVoucherList(report: ExportVoucherListReport) {
  return {
    ...serializeKind(report.voucherKind),
    comprobantes: report.vouchers.map((voucher) =>
      voucher.unreadable ? serializeUnreadable(voucher) : serializeVoucher(voucher),
    ),
    entorno: report.environment,
    puntoVenta: report.pointOfSale,
  };
}

export function serializeExportVoucherDetail(report: ExportVoucherDetailReport): Record<string, unknown> {
  return {
    ...serializeKind(report.voucherKind),
    ...serializeVoucher(report.voucher),
    entorno: report.environment,
    puntoVenta: report.pointOfSale,
  };
}
