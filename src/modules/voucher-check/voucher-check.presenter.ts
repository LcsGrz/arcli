import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { formatCuit } from '../../lib/identity/format-cuit';
import { formatArgentineAmount } from '../../lib/numbers/argentine-amount';
import { attentionPanel, errorListPanel, sheetPanel } from '../../ui/components';
import { renderKeyValueRows, resolveKeyValueLabelWidth } from '../../ui/primitives';
import { documentTypeFromCode, documentTypeLabel, isTaxIdDocumentType } from '../billing/arca-codes';
import { formatArcaMessages, formatMoneyLabel, formatNumericLabel } from '../billing/billing.labels';
import { getVoucherKindByArcaType } from '../billing/voucher-kind-map';
import { getExportVoucherKindByArcaType } from '../export/export.kinds';
import { formatVoucherNumber } from '../vouchers/voucher-number';

import { type ArcaMessage, isChecked, type VoucherCheckReceiver, type VoucherCheckReport } from './voucher-check';

function serializeMessages(messages: readonly ArcaMessage[]) {
  return messages.map(({ code, message }) => ({ codigo: code, mensaje: message }));
}

/** El `--json` de `arcli constatar`: lo que se constató, tal como se mandó, y lo que contestó ARCA. */
export function serializeVoucherCheck(report: VoucherCheckReport) {
  const { answer, environment, request } = report;

  return {
    atajo: request.shortcut,
    codigoAutorizacion: request.authorizationCode,
    constatado: isChecked(report),
    emisor: request.issuerCuit,
    entorno: environment,
    errores: serializeMessages(answer.errors),
    eventos: serializeMessages(answer.events),
    fecha: request.date,
    fechaProceso: answer.processedAt,
    importeTotal: request.total,
    modo: request.mode,
    numero: request.number,
    observaciones: serializeMessages(answer.observations),
    puntoVenta: request.pointOfSale,
    receptor: request.receiver
      ? { numero: request.receiver.documentNumber, tipoDocumento: request.receiver.documentType }
      : null,
    resultado: answer.result,
    tipoArca: request.voucherType,
  };
}

/** `Factura A`; un tipo que ARCLI no emite, con su código: `Tipo 51 de ARCA`. */
function voucherTypeLabel(voucherType: number): string {
  return (
    getVoucherKindByArcaType(voucherType)?.displayName ??
    getExportVoucherKindByArcaType(voucherType)?.displayName ??
    `Tipo ${voucherType} de ARCA`
  );
}

/** `CUIT 20-11111111-2`, `DNI 11.111.111`. */
function receiverLabel({ documentNumber, documentType }: VoucherCheckReceiver): string {
  const number = isTaxIdDocumentType(documentType)
    ? formatCuit(documentNumber)
    : formatNumericLabel(Number(documentNumber));
  const label = documentTypeFromCode(documentType) ? documentTypeLabel(documentType) : `Documento ${documentType}`;

  return `${label} ${number}`;
}

/**
 * Con la moneda del QR, como el resto de los importes (`$ 1.000`, `1.000 USD`). Con los flags no se sabe la moneda: el
 * número solo, en formato argentino.
 */
function formatTotal(total: number, currency: string | null): string {
  return currency ? formatMoneyLabel(total, currency) : formatArgentineAmount(total);
}

/** `FchProceso` (`yyyymmddhhmmss`) como `17/11/2026 12:00`; lo que no tenga esa forma no se muestra. */
function formatProcessedAt(value: string | null): string | undefined {
  const match = value ? /^(\d{8})(\d{2})(\d{2})\d{2}$/.exec(value) : null;

  return match ? `${formatArcaDateAsArgentineDate(match[1]!)} ${match[2]}:${match[3]}` : undefined;
}

function messageRows(messages: readonly ArcaMessage[]): string {
  return formatArcaMessages(messages.map(({ code, message }) => ({ Code: code, Msg: message })));
}

/** La ficha, con el veredicto al pie, y debajo lo que dijo ARCA: el motivo del rechazo o el aviso del constatado. */
export function formatVoucherCheckAsText(report: VoucherCheckReport): string {
  const { answer, request } = report;
  const checked = isChecked(report);
  const rows: Array<readonly [string, string | undefined]> = [
    [
      'Comprobante',
      `${voucherTypeLabel(request.voucherType)} ${formatVoucherNumber(request.pointOfSale, request.number)}`,
    ],
    ['Emisor', formatCuit(request.issuerCuit)],
    ['Fecha', formatArcaDateAsArgentineDate(request.date)],
    ['Importe total', formatTotal(request.total, request.currency)],
    [request.mode, request.authorizationCode],
    ['Receptor', request.receiver ? receiverLabel(request.receiver) : undefined],
    [checked ? 'Constatado el' : 'Consultado el', formatProcessedAt(answer.processedAt)],
  ];
  const sheet = sheetPanel(
    'Constatación de comprobante',
    renderKeyValueRows(rows, { labelWidth: resolveKeyValueLabelWidth('standard', rows) }),
    checked ? { footer: 'CONSTATADO', tone: 'success' } : { footer: 'NO CONSTATADO', tone: 'danger' },
  );
  const panels = [sheet];

  if (answer.observations.length > 0) {
    panels.push(
      checked
        ? attentionPanel('Observaciones de ARCA', messageRows(answer.observations))
        : errorListPanel('Motivo de ARCA', messageRows(answer.observations)),
    );
  }

  if (!checked && answer.observations.length === 0 && answer.errors.length === 0) {
    panels.push(errorListPanel('Motivo de ARCA', 'ARCA no informó el motivo.'));
  }

  if (answer.errors.length > 0) {
    panels.push(errorListPanel('Errores de ARCA', messageRows(answer.errors)));
  }

  if (answer.events.length > 0) {
    panels.push(attentionPanel('Eventos de ARCA', messageRows(answer.events)));
  }

  return panels.join('\n\n');
}
