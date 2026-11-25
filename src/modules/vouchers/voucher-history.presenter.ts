import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { formatCuit } from '../../lib/identity/format-cuit';
import { formatExchangeRate } from '../../lib/numbers/argentine-amount';
import { joinWithAnd } from '../../lib/text/join-with-and';
import { attentionPanel, listingPanel, noticePanel, ticketPanel } from '../../ui/components';
import { renderKeyValueRows, resolveKeyValueLabelWidth, uiSymbol } from '../../ui/primitives';
import {
  CONSUMER_DOCUMENT_TYPE_CODE,
  CONSUMER_IVA_CONDITION_CODE,
  documentTypeFromCode,
  documentTypeLabel,
  isTaxIdDocumentType,
} from '../billing/arca-codes';
import { resolveIvaRateLabel } from '../billing/billing.amounts';
import {
  formatConceptLabel,
  formatCurrencyLabel,
  formatFceOptionalRow,
  formatIvaConditionLabel,
  formatMoneyLabel,
  formatNumericLabel,
  formatTaxIdLabel,
  MISSING_CAE_TEXT,
} from '../billing/billing.labels';
import type { VoucherKindDefinition } from '../billing/billing.types';
import { ARCA_LOCAL_CURRENCY_CODE } from '../billing/currency-codes';
import { getVoucherKindByArcaType } from '../billing/voucher-kind-map';
import { formatLatestVouchersTitle, formatNoVouchersEmitted } from '../billing/voucher-names';
import { formatEnvironmentLabel } from '../config/config.schemas';

import type { IssuedVoucher, ListedVoucher, UnreadableVoucher } from './voucher-history';
import { formatVoucherNumber } from './voucher-number';

export interface VoucherListReport {
  readonly environment: 'produccion' | 'testing';
  readonly pointOfSale: number;
  readonly voucherKind: VoucherKindDefinition;
  readonly vouchers: ReadonlyArray<ListedVoucher<IssuedVoucher>>;
}

export interface VoucherDetailReport {
  readonly environment: 'produccion' | 'testing';
  readonly pointOfSale: number;
  readonly voucher: IssuedVoucher;
  readonly voucherKind: VoucherKindDefinition;
}

export function formatReceiver(voucher: IssuedVoucher): string {
  if (voucher.documentTypeCode === CONSUMER_DOCUMENT_TYPE_CODE) {
    return 'Consumidor final';
  }

  // `documentTypeLabel` devuelve el código solo para uno desconocido: acá va con "Doc" adelante.
  const label = documentTypeFromCode(voucher.documentTypeCode)
    ? documentTypeLabel(voucher.documentTypeCode)
    : `Doc ${voucher.documentTypeCode}`;

  const number = isTaxIdDocumentType(voucher.documentTypeCode)
    ? formatCuit(voucher.documentNumber)
    : formatNumericLabel(voucher.documentNumber);

  return `${label} ${number}`;
}

/** Titulo del listado de ultimos comprobantes, tambien usado por el selector del modo interactivo. */
function formatVoucherListTitle(report: Omit<VoucherListReport, 'vouchers'>): string {
  const separator = uiSymbol('separator');

  return `${formatLatestVouchersTitle(report.voucherKind)} ${separator} PV ${report.pointOfSale} ${separator} ${formatEnvironmentLabel(report.environment)}`;
}

/** Los que ARCA tiene y no se pudieron leer, con que no hay que repetirlos. Sin ninguno, vacio. */
function unreadableNotice(
  pointOfSale: number,
  vouchers: ReadonlyArray<ListedVoucher<object>>,
  describe: (count: number) => string,
): string {
  const labels = vouchers.filter(isUnreadable).map(({ number }) => formatVoucherNumber(pointOfSale, number));

  if (labels.length === 0) {
    return '';
  }

  return noticePanel(
    `${describe(labels.length)}: ${joinWithAnd(labels)}. ${labels.length === 1 ? 'Existe en ARCA: no lo repitas.' : 'Existen en ARCA: no los repitas.'}`,
    'warning',
  );
}

function isUnreadable(voucher: ListedVoucher<object>): voucher is UnreadableVoucher {
  return 'unreadable' in voucher && voucher.unreadable === true;
}

/** El aviso de `ultimos`, que los muestra en su lugar. */
export function formatUnreadableVouchers(pointOfSale: number, vouchers: ReadonlyArray<ListedVoucher<object>>): string {
  return unreadableNotice(
    pointOfSale,
    vouchers,
    (count) => `ARCLI no pudo leer los datos de ${count === 1 ? '1 comprobante' : `${count} comprobantes`}`,
  );
}

/** El aviso de las listas del asistente, que no los muestran: no se pueden elegir. */
export function formatSkippedVouchers(pointOfSale: number, vouchers: ReadonlyArray<ListedVoucher<object>>): string {
  return unreadableNotice(
    pointOfSale,
    vouchers,
    (count) =>
      `${count === 1 ? 'No se muestra 1 comprobante' : `No se muestran ${count} comprobantes`}, porque ARCLI no pudo leer sus datos`,
  );
}

const DATE_WIDTH = 10;
const RECEIVER_WIDTH = 20;
const TOTAL_WIDTH = 16;
const COLUMN_GAP = '  ';

/** Las columnas de una fila de `ultimos`, A, B, C y E. */
export function formatListColumns(columns: VoucherPickerColumns): string {
  return [
    columns.number,
    columns.date,
    columns.receiver.padEnd(RECEIVER_WIDTH),
    columns.total.padStart(TOTAL_WIDTH),
    columns.cae,
  ]
    .join(COLUMN_GAP)
    .trimEnd();
}

/** El que no se pudo leer, en su lugar: el texto ocupa las columnas de la fecha, el receptor y el total. */
export function formatUnreadableRow(pointOfSale: number, voucher: UnreadableVoucher): string {
  return [
    formatVoucherNumber(pointOfSale, voucher.number),
    'No se pudieron leer sus datos'.padEnd(DATE_WIDTH + RECEIVER_WIDTH + TOTAL_WIDTH + 2 * COLUMN_GAP.length),
    `CAE ${voucher.cae}`,
  ].join(COLUMN_GAP);
}

/** El que no se pudo leer en `comprobantes`: solo lo que se sabe de el. */
export function serializeUnreadable(voucher: UnreadableVoucher): Record<string, unknown> {
  return {
    cae: voucher.cae,
    error: 'No se pudieron leer los datos que devolvió ARCA.',
    numero: voucher.number,
  };
}

/** Una fila del listado: numero, fecha, receptor, total y CAE, en columnas alineadas. */
function formatVoucherListRow(pointOfSale: number, voucher: ListedVoucher<IssuedVoucher>): string {
  if (voucher.unreadable) {
    return formatUnreadableRow(pointOfSale, voucher);
  }

  return formatListColumns(voucherColumns(pointOfSale, voucher));
}

/**
 * Reparte `extra` espacios entre los separadores, a los dos lados del simbolo: ` · ` pasa a `  ·  `, y asi.
 * Los primeros se llevan el sobrante de la division.
 */
function widenSeparators(separator: string, count: number, extra: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const spaces = Math.floor(extra / count) + (index < extra % count ? 1 : 0);
    const left = Math.floor(spaces / 2);

    return `${' '.repeat(left)}${separator}${' '.repeat(spaces - left)}`;
  });
}

/** Las columnas de una fila del selector del modo interactivo. */
export interface VoucherPickerColumns {
  readonly cae: string;
  readonly date: string;
  readonly number: string;
  readonly receiver: string;
  readonly total: string;
}

/**
 * Alinea las filas del selector: cada columna mide lo justo para el dato mas largo de la lista y las separa
 * `separator`. Con `width`, los separadores se agrandan para que las filas ocupen ese ancho, si entran.
 * La usan A, B y C y tambien la E, que tiene cliente en vez de receptor con documento.
 */
export function alignVoucherPickerRows(
  columns: readonly VoucherPickerColumns[],
  separator: string,
  width?: number,
): string[] {
  const receiverWidth = Math.max(0, ...columns.map((column) => column.receiver.length));
  const totalWidth = Math.max(0, ...columns.map((column) => column.total.length));
  const cells = columns.map((column) =>
    [
      column.number,
      column.date,
      column.receiver.padEnd(receiverWidth),
      column.total.padStart(totalWidth),
      column.cae,
    ].filter(Boolean),
  );
  const natural = Math.max(0, ...cells.map((row) => row.join(separator).length));
  const gaps = Math.max(0, ...cells.map((row) => row.length - 1));
  const extra = width === undefined || gaps === 0 ? 0 : Math.max(0, width - natural);
  const separators = widenSeparators(separator, gaps, extra);

  return cells.map((row) =>
    row.map((cell, index) => (index === 0 ? cell : `${separators[index - 1]}${cell}`)).join(''),
  );
}

function voucherColumns(pointOfSale: number, voucher: IssuedVoucher): VoucherPickerColumns {
  return {
    cae: voucher.cae ? `CAE ${voucher.cae}` : '',
    date: formatArcaDateAsArgentineDate(voucher.date),
    number: formatVoucherNumber(pointOfSale, voucher.number),
    receiver: formatReceiver(voucher),
    total: formatMoneyLabel(voucher.total, voucher.currency),
  };
}

/** Filas para elegir un comprobante A, B o C: numero, fecha, receptor, total y CAE. */
export function formatVoucherPickerRows(
  pointOfSale: number,
  vouchers: readonly IssuedVoucher[],
  separator: string,
  width?: number,
): string[] {
  return alignVoucherPickerRows(
    vouchers.map((voucher) => voucherColumns(pointOfSale, voucher)),
    separator,
    width,
  );
}

export function formatVoucherListAsText(report: VoucherListReport): string {
  const { pointOfSale, voucherKind, vouchers } = report;

  if (vouchers.length === 0) {
    return noticePanel(`${formatNoVouchersEmitted(voucherKind)} en el punto de venta ${pointOfSale}.`, 'muted');
  }

  const listing = listingPanel(
    formatVoucherListTitle(report),
    vouchers.map((voucher) => formatVoucherListRow(pointOfSale, voucher)),
  );

  return [listing, formatUnreadableVouchers(pointOfSale, vouchers)].filter(Boolean).join('\n\n');
}

function serializeVoucher(voucher: IssuedVoucher): Record<string, unknown> {
  return {
    cae: voucher.cae ?? null,
    caeVencimiento: voucher.caeExpiration ?? null,
    concepto: voucher.concept ?? null,
    cotizacion: voucher.exchangeRate ?? null,
    fecha: voucher.date,
    importes: {
      exento: voucher.exemptAmount ?? 0,
      iva: voucher.ivaAmount,
      neto: voucher.netAmount,
      noGravado: voucher.untaxedAmount ?? 0,
      total: voucher.total,
      tributos: voucher.taxesAmount ?? 0,
    },
    moneda: voucher.currency ?? null,
    numero: voucher.number,
    numeroDocumento: voucher.documentNumber,
    resultado: voucher.result ?? null,
    tipoDocumento: voucher.documentTypeCode,
    ...serializeVoucherExtras(voucher),
  };
}

/**
 * Lo que `getVoucherInfo` del SDK descartaba (SDK-13), con las claves de `--cargar` donde coinciden. Son campos
 * nuevos: las listas salen vacias y el resto en `null` si ARCA no los informa.
 */
function serializeVoucherExtras(voucher: IssuedVoucher): Record<string, unknown> {
  return {
    alicuotasIva: (voucher.ivaAliquots ?? []).map((aliquot) => ({
      baseImponible: aliquot.base,
      id: aliquot.id,
      importe: aliquot.amount,
    })),
    comprobantesAsociados: (voucher.associatedVouchers ?? []).map((associated) => ({
      atajo: getVoucherKindByArcaType(associated.arcaType)?.shortcut ?? null,
      cuit: associated.cuit ?? null,
      fecha: associated.date ?? null,
      numero: associated.number,
      puntoVenta: associated.pointOfSale,
      tipoArca: associated.arcaType,
    })),
    condicionIvaReceptor: voucher.receiverIvaConditionCode ?? null,
    mismaMoneda: voucher.sameCurrency ?? null,
    observaciones: voucher.observations ?? [],
    opcionales: (voucher.optionals ?? []).map((optional) => ({ id: optional.id, valor: optional.value })),
    periodoAsociado: voucher.associatedPeriod
      ? { desde: voucher.associatedPeriod.from, hasta: voucher.associatedPeriod.to }
      : null,
    servicioDesde: voucher.serviceFrom ?? null,
    servicioHasta: voucher.serviceTo ?? null,
    tributos: (voucher.taxes ?? []).map((tax) => ({
      alicuota: tax.rate,
      baseImponible: tax.base,
      descripcion: tax.description ?? null,
      id: tax.id,
      importe: tax.amount,
    })),
    vencimientoPago: voucher.paymentDueDate ?? null,
  };
}

function serializeVoucherKind(voucherKind: VoucherKindDefinition): Record<string, unknown> {
  return { atajo: voucherKind.shortcut, comprobante: voucherKind.displayName, tipoArca: voucherKind.arcaType };
}

export function serializeVoucherList(report: VoucherListReport) {
  return {
    ...serializeVoucherKind(report.voucherKind),
    comprobantes: report.vouchers.map((voucher) =>
      voucher.unreadable ? serializeUnreadable(voucher) : serializeVoucher(voucher),
    ),
    entorno: report.environment,
    puntoVenta: report.pointOfSale,
  };
}

export function serializeVoucherDetail(report: VoucherDetailReport): Record<string, unknown> {
  return {
    ...serializeVoucherKind(report.voucherKind),
    ...serializeVoucher(report.voucher),
    entorno: report.environment,
    puntoVenta: report.pointOfSale,
  };
}

/** Una fila sin valor no se muestra (renderKeyValueRows). */
type Row = readonly [string, string | undefined];

/** El IVA del receptor, salvo el de consumidor final sin identificar, que ya dice la fila del receptor. */
function formatReceiverIvaRows(voucher: IssuedVoucher): Row[] {
  const code = voucher.receiverIvaConditionCode;

  // Un comprobante viejo puede traer 0: no es una condicion, es que no se informo.
  if (code === undefined || code === 0) {
    return [];
  }

  if (voucher.documentTypeCode === CONSUMER_DOCUMENT_TYPE_CODE && code === CONSUMER_IVA_CONDITION_CODE) {
    return [];
  }

  return [['IVA receptor', formatIvaConditionLabel(code)]];
}

/** Una alicuota: su tasa. Varias: el IVA y la base de cada una. Como en la vista previa al emitir. */
function formatIvaAliquotRows(voucher: IssuedVoucher): Row[] {
  const aliquots = voucher.ivaAliquots ?? [];
  const label = (id: number) => resolveIvaRateLabel(id) ?? String(id);

  if (aliquots.length === 1 && aliquots[0]) {
    return [['Alícuota de IVA', label(aliquots[0].id)]];
  }

  return aliquots.map((aliquot) => [
    `IVA ${label(aliquot.id)}`,
    `${formatMoneyLabel(aliquot.amount, voucher.currency)} sobre ${formatMoneyLabel(aliquot.base, voucher.currency)}`,
  ]);
}

function formatTaxRows(voucher: IssuedVoucher): Row[] {
  return (voucher.taxes ?? []).map((tax) => [
    tax.description ?? `Tributo ${tax.id}`,
    formatMoneyLabel(tax.amount, voucher.currency),
  ]);
}

/** Periodo de servicio, vencimiento del pago, asociados, periodo asociado y opcionales de FCE: solo si hay. */
function formatVoucherExtraRows(voucher: IssuedVoucher): Row[] {
  const rows: Row[] = [];

  if (voucher.serviceFrom) rows.push(['Servicio desde', formatArcaDateAsArgentineDate(voucher.serviceFrom)]);
  if (voucher.serviceTo) rows.push(['Servicio hasta', formatArcaDateAsArgentineDate(voucher.serviceTo)]);
  if (voucher.paymentDueDate) {
    rows.push(['Vencimiento del pago', formatArcaDateAsArgentineDate(voucher.paymentDueDate)]);
  }

  for (const associated of voucher.associatedVouchers ?? []) {
    const name = getVoucherKindByArcaType(associated.arcaType)?.displayName ?? `Tipo ${associated.arcaType}`;

    rows.push(
      ['Comprobante asociado', name],
      ['Número asociado', formatVoucherNumber(associated.pointOfSale, associated.number)],
    );

    if (associated.cuit) rows.push(['CUIT asociado', formatTaxIdLabel(associated.cuit)]);
    if (associated.date) rows.push(['Fecha asociado', formatArcaDateAsArgentineDate(associated.date)]);
  }

  if (voucher.associatedPeriod) {
    rows.push([
      'Período asociado',
      `${formatArcaDateAsArgentineDate(voucher.associatedPeriod.from)} al ${formatArcaDateAsArgentineDate(voucher.associatedPeriod.to)}`,
    ]);
  }

  for (const optional of voucher.optionals ?? []) {
    const row = formatFceOptionalRow(optional.id, optional.value);

    if (row) rows.push(row);
  }

  return rows;
}

export function formatVoucherDetailAsText(report: VoucherDetailReport): string {
  const { pointOfSale, voucher, voucherKind } = report;
  const foreignCurrency = Boolean(voucher.currency && voucher.currency !== ARCA_LOCAL_CURRENCY_CODE);
  const rows: Row[] = [
    ['Número', formatVoucherNumber(pointOfSale, voucher.number)],
    ['Fecha del comprobante', formatArcaDateAsArgentineDate(voucher.date)],
    ['Receptor', formatReceiver(voucher)],
    ...formatReceiverIvaRows(voucher),
    // 0 no es un concepto de ARCA: sin dato, la fila no va.
    ['Concepto', voucher.concept ? formatConceptLabel(voucher.concept) : undefined],
    ['Moneda', formatCurrencyLabel(voucher.currency)],
  ];

  if (foreignCurrency) {
    rows.push(['Cotización', formatExchangeRate(voucher.exchangeRate ?? 1)]);

    if (voucher.sameCurrency) rows.push(['Pago en la misma moneda', 'Sí']);
  }

  rows.push(['Importe neto', formatMoneyLabel(voucher.netAmount, voucher.currency)]);

  if (voucher.ivaAmount) rows.push(['Importe IVA', formatMoneyLabel(voucher.ivaAmount, voucher.currency)]);

  rows.push(...formatIvaAliquotRows(voucher));

  if (voucher.exemptAmount) rows.push(['Importe exento', formatMoneyLabel(voucher.exemptAmount, voucher.currency)]);
  if (voucher.untaxedAmount)
    rows.push(['Importe no gravado', formatMoneyLabel(voucher.untaxedAmount, voucher.currency)]);
  if (voucher.taxesAmount) rows.push(['Importe tributos', formatMoneyLabel(voucher.taxesAmount, voucher.currency)]);

  rows.push(
    ...formatTaxRows(voucher),
    ['Importe total', formatMoneyLabel(voucher.total, voucher.currency)],
    ...formatVoucherExtraRows(voucher),
    ['CAE', voucher.cae || MISSING_CAE_TEXT],
  );

  if (voucher.caeExpiration) {
    rows.push(['Vencimiento CAE', formatArcaDateAsArgentineDate(voucher.caeExpiration)]);
  }

  const ticket = ticketPanel(
    voucherKind.displayName,
    renderKeyValueRows(rows, { labelWidth: resolveKeyValueLabelWidth('ticket', rows) }),
    {
      footer: voucher.result === 'A' ? 'APROBADO' : voucher.result === 'R' ? 'RECHAZADO' : undefined,
      tone: voucher.result === 'R' ? 'danger' : 'success',
    },
  );
  const observations = voucher.observations ?? [];

  return observations.length > 0
    ? [
        ticket,
        attentionPanel('Observaciones', observations.map((item, index) => `${index + 1}. ${item}`).join('\n')),
      ].join('\n\n')
    : ticket;
}
