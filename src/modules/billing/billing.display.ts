import type { IIva } from '../../services/arca/arca-sdk.types';
import { renderKeyValueRows, resolveKeyValueLabelWidth } from '../../ui/primitives';
import { formatVoucherNumber } from '../vouchers/voucher-history.presenter';

import { CONSUMER_DOCUMENT_TYPE_CODE, CONSUMER_IVA_CONDITION_CODE, isTaxIdDocumentType } from './arca-codes';
import { resolveIvaRateLabel } from './billing.amounts';
import {
  formatConceptLabel,
  formatCurrencyLabel,
  formatDateLabel,
  formatDecimalLabel,
  formatDocumentTypeLabel,
  formatIvaConditionLabel,
  formatMoneyLabel,
  formatNumericLabel,
  formatTaxIdLabel,
} from './billing.labels';
import type { BillingExecutionResult } from './billing.types.internal';
import { getVoucherKindByArcaType } from './voucher-kind-map';

export function formatVoucherSummary(result: BillingExecutionResult): Record<string, unknown> {
  return {
    cae: result.response.cae,
    caeVencimiento: result.response.caeVencimiento,
    comprobante: result.voucherKind.displayName,
    errores: result.response.errors,
    estado: result.response.status,
    eventos: result.response.events,
    observaciones: result.response.observaciones,
    observacion: result.response.observacion,
    solicitud: result.payload,
    previsualizacion: result.dryRun,
    resultado: result.response.resultado,
    tipoArca: result.voucherKind.arcaType,
  };
}

const FCE_OPTIONAL_LABELS: Record<string, string> = {
  '22': 'Anulación',
  '27': 'Transferencia',
  '2101': 'CBU',
  '2102': 'Alias CBU',
};

/** Una alicuota: su tasa. Varias: el desglose de neto e IVA de cada una. */
function formatIvaRows(iva: readonly IIva[], currency: string): Array<readonly [string, string]> {
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
function formatReceiverRows(result: BillingExecutionResult): Array<readonly [string, string]> {
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
      typeof payload.DocNro === 'number'
        ? isTaxIdDocumentType(payload.DocTipo)
          ? formatTaxIdLabel(payload.DocNro)
          : formatNumericLabel(payload.DocNro)
        : 'N/D',
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

function formatFriendlyPayloadRows(result: BillingExecutionResult): Array<readonly [string, string]> {
  const payload = result.payload;
  const rows: Array<readonly [string, string]> = [
    ['Concepto', formatConceptLabel(payload.Concepto)],
    ['Punto de venta', String(payload.PtoVta)],
    ['Fecha del comprobante', formatDateLabel(payload.CbteFch)],
    ...formatReceiverRows(result),
    ['Moneda', formatCurrencyLabel(payload.MonId)],
    ...(payload.MonId === 'PES' ? [] : [['Cotización', formatDecimalLabel(payload.MonCotiz)] as const]),
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
    rows.push([
      'Período asociado',
      `${formatDateLabel(payload.PeriodoAsoc.FchDesde)} al ${formatDateLabel(payload.PeriodoAsoc.FchHasta)}`,
    ]);
  }

  for (const optional of payload.Opcionales ?? []) {
    const label = FCE_OPTIONAL_LABELS[optional.Id];

    if (label) {
      rows.push([label, optional.Id === '22' ? (optional.Valor === 'S' ? 'Sí' : 'No') : optional.Valor]);
    }
  }

  return rows;
}

export function formatPayloadTable(result: BillingExecutionResult): string {
  const rows = formatFriendlyPayloadRows(result);

  return renderKeyValueRows(rows, { labelWidth: resolveKeyValueLabelWidth('ticket', rows) }).join('\n');
}

/** CAE, vencimiento, numero e importe: el resumen del resultado. */
export function formatResultSummary(result: BillingExecutionResult): Array<readonly [string, string | number]> {
  return [
    ['CAE', result.response.cae ?? 'N/D'],
    ['Vencimiento CAE', formatDateLabel(result.response.caeVencimiento ?? undefined)],
    result.voucherNumber === undefined
      ? ['Punto de venta', result.payload.PtoVta]
      : ['Número', formatVoucherNumber(result.payload.PtoVta, result.voucherNumber)],
    ['Importe total', formatMoneyLabel(result.payload.ImpTotal, result.payload.MonId)],
  ];
}
