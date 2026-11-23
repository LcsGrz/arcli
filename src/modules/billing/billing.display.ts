import type { IIva } from '../../services/arca/arca-sdk.types';
import { renderKeyValueRows, resolveKeyValueLabelWidth } from '../../ui/primitives';
import { formatVoucherNumber } from '../vouchers/voucher-number';

import { CONSUMER_DOCUMENT_TYPE_CODE, CONSUMER_IVA_CONDITION_CODE, isTaxIdDocumentType } from './arca-codes';
import { resolveIvaRateLabel } from './billing.amounts';
import {
  formatConceptLabel,
  formatCurrencyLabel,
  formatDateLabel,
  formatDecimalLabel,
  formatDocumentTypeLabel,
  formatFceOptionalRow,
  formatIvaConditionLabel,
  formatMoneyLabel,
  formatNumericLabel,
  formatTaxIdLabel,
  MISSING_CAE_TEXT,
} from './billing.labels';
import type { BillingExecutionResult } from './billing.types.internal';
import { ARCA_LOCAL_CURRENCY_CODE } from './currency-codes';
import { getVoucherKindByArcaType } from './voucher-kind-map';

/** Una fila sin valor no se muestra (renderKeyValueRows). */
type Row = readonly [string, string | undefined];

/** Una alicuota: su tasa. Varias: el desglose de neto e IVA de cada una. */
function formatIvaRows(iva: readonly IIva[], currency: string): Row[] {
  if (iva.length === 0) {
    return [];
  }

  const label = (aliquotId: number) => resolveIvaRateLabel(aliquotId) ?? String(aliquotId);

  if (iva.length === 1 && iva[0]) {
    return [['Alícuota de IVA', label(iva[0].Id)]];
  }

  return iva.map(
    (item) =>
      [
        `IVA ${label(item.Id)}`,
        `${formatMoneyLabel(item.Importe, currency)} sobre ${formatMoneyLabel(item.BaseImp, currency)}`,
      ] as const,
  );
}

/** El receptor: consumidor final sin identificar es una sola fila; su IVA solo si es otro. */
function formatReceiverRows(result: BillingExecutionResult): Row[] {
  const payload = result.payload;
  const ivaRow = [
    'IVA receptor',
    `${formatIvaConditionLabel(payload.CondicionIVAReceptorId)}${result.receiver?.ivaConditionFromPadron ? ' (padrón)' : ''}`,
  ] as const;

  if (payload.DocTipo === CONSUMER_DOCUMENT_TYPE_CODE && payload.DocNro === 0) {
    return [
      ['Receptor', 'Consumidor final'],
      ...(payload.CondicionIVAReceptorId === CONSUMER_IVA_CONDITION_CODE ? [] : [ivaRow]),
    ];
  }

  return [
    ['Tipo de documento', formatDocumentTypeLabel(payload.DocTipo)],
    [
      'Número de documento',
      isTaxIdDocumentType(payload.DocTipo) ? formatTaxIdLabel(payload.DocNro) : formatNumericLabel(payload.DocNro),
    ],
    ...(result.receiver?.name ? [['Receptor', result.receiver.name] as const] : []),
    ivaRow,
  ];
}

/**
 * Lo que ARCA recibe en cero porque nadie lo cargo no se muestra. Lo que tiene valor si, venga de una flag, de la
 * config o de un default. El `--json` y `--bruto` siguen trayendo todo.
 */
function formatOptionalMoneyRow(label: string, value: number | undefined, currency: string) {
  return value ? [[label, formatMoneyLabel(value, currency)] as const] : [];
}

/** "01/10/2026 al 31/10/2026"; con una sola punta, "desde ..." o "hasta ..."; sin ninguna, la fila no va. */
function formatAssociatedPeriod(period: {
  readonly FchDesde?: string;
  readonly FchHasta?: string;
}): string | undefined {
  const from = formatDateLabel(period.FchDesde);
  const to = formatDateLabel(period.FchHasta);

  if (from && to) {
    return `${from} al ${to}`;
  }

  if (from) {
    return `desde ${from}`;
  }

  return to ? `hasta ${to}` : undefined;
}

function formatFriendlyPayloadRows(result: BillingExecutionResult): Row[] {
  const payload = result.payload;
  const rows: Row[] = [
    ['Concepto', formatConceptLabel(payload.Concepto)],
    ['Punto de venta', String(payload.PtoVta)],
    ['Fecha del comprobante', formatDateLabel(payload.CbteFch)],
    ...formatReceiverRows(result),
    ['Moneda', formatCurrencyLabel(payload.MonId)],
    ...(payload.MonId === ARCA_LOCAL_CURRENCY_CODE
      ? []
      : [['Cotización', formatDecimalLabel(payload.MonCotiz)] as const]),
    ['Importe neto', formatMoneyLabel(payload.ImpNeto, payload.MonId)],
    ...formatOptionalMoneyRow('Importe IVA', payload.ImpIVA, payload.MonId),
    ...formatIvaRows(payload.Iva ?? [], payload.MonId),
    ...formatOptionalMoneyRow('Importe tributos', payload.ImpTrib, payload.MonId),
    ...formatOptionalMoneyRow('Importe exento', payload.ImpOpEx, payload.MonId),
    ...formatOptionalMoneyRow('Importe no gravado', payload.ImpTotConc, payload.MonId),
    ['Importe total', formatMoneyLabel(payload.ImpTotal, payload.MonId)],
  ];

  if (payload.FchServDesde) {
    rows.push(['Servicio desde', formatDateLabel(payload.FchServDesde)]);
  }

  if (payload.FchServHasta) {
    rows.push(['Servicio hasta', formatDateLabel(payload.FchServHasta)]);
  }

  if (payload.FchVtoPago) {
    rows.push(['Vencimiento del pago', formatDateLabel(payload.FchVtoPago)]);
  }

  const associatedVoucher = payload.CbtesAsoc?.[0];

  if (associatedVoucher) {
    const associatedKind = getVoucherKindByArcaType(associatedVoucher.Tipo);

    rows.push(['Comprobante asociado', associatedKind ? associatedKind.displayName : String(associatedVoucher.Tipo)]);
    rows.push(['Número asociado', formatVoucherNumber(associatedVoucher.PtoVta, associatedVoucher.Nro)]);
    rows.push(['CUIT asociado', formatTaxIdLabel(associatedVoucher.Cuit)]);

    if (associatedVoucher.CbteFch) {
      rows.push(['Fecha asociado', formatDateLabel(associatedVoucher.CbteFch)]);
    }
  }

  if (payload.PeriodoAsoc) {
    rows.push(['Período asociado', formatAssociatedPeriod(payload.PeriodoAsoc)]);
  }

  for (const optional of payload.Opcionales ?? []) {
    const row = formatFceOptionalRow(optional.Id, optional.Valor);

    if (row) {
      rows.push(row);
    }
  }

  return rows;
}

export function formatPayloadTable(result: BillingExecutionResult): string {
  const rows = formatFriendlyPayloadRows(result);

  return renderKeyValueRows(rows, { labelWidth: resolveKeyValueLabelWidth('ticket', rows) }).join('\n');
}

/** CAE, vencimiento, numero e importe: el resumen del resultado. Sin CAE, la fila lo dice y el vencimiento no va. */
export function formatResultSummary(
  result: BillingExecutionResult,
): Array<readonly [string, string | number | undefined]> {
  return [
    ['CAE', result.response.cae || MISSING_CAE_TEXT],
    ['Vencimiento CAE', formatDateLabel(result.response.caeVencimiento ?? undefined)],
    result.voucherNumber === undefined
      ? ['Punto de venta', result.payload.PtoVta]
      : ['Número', formatVoucherNumber(result.payload.PtoVta, result.voucherNumber)],
    ['Importe total', formatMoneyLabel(result.payload.ImpTotal, result.payload.MonId)],
  ];
}
