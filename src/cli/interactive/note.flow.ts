import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { formatMoneyLabel } from '../../modules/billing/billing.labels';
import { billingCommandSchema, type BillingConcept } from '../../modules/billing/billing.schemas';
import { parseAmountInput } from '../../modules/interactive/amount-input';
import {
  invoiceKindChoices,
  ivaConditionChoices,
  ivaRateChoices,
  noteKindChoices,
} from '../../modules/interactive/choices';
import {
  inferIvaRate,
  type IssuedVoucher,
  listRecentVouchers,
  resolveDocumentType,
} from '../../modules/vouchers/voucher-history';
import { formatVoucherSummary } from '../../modules/vouchers/voucher-history.presenter';
import { noticePanel, writeTerminalOutput } from '../../ui';
import { startSpinner } from '../spinner';

import { askText, chooseOne, confirm } from './prompts';
import { type InteractiveSession, previewAndEmit, requirePointOfSale } from './session';
import { validateAmount } from './validators';

const CONCEPTS_BY_CODE: Record<number, BillingConcept> = {
  1: 'productos',
  2: 'servicios',
  3: 'productos-servicios',
};

async function askNoteAmount(kind: 'credito' | 'debito', invoice: IssuedVoucher): Promise<number | undefined> {
  if (kind === 'debito') {
    return parseAmountInput(await askText('Monto de la nota de debito:', { validate: validateAmount }));
  }

  const scope = await chooseOne('¿Total o parcial?', [
    { name: `Anular el total (${formatMoneyLabel(invoice.total)})`, value: 'total' as const },
    { name: 'Parcial (ingresar monto)', value: 'parcial' as const },
  ]);

  if (scope === 'total') {
    return invoice.total;
  }

  const answer = await askText('Monto de la nota de credito:', {
    validate: (value) => {
      const valid = validateAmount(value);

      if (valid !== true) {
        return valid;
      }

      return (parseAmountInput(value) ?? 0) <= invoice.total
        ? true
        : `No puede superar el total de la factura (${formatMoneyLabel(invoice.total)}).`;
    },
  });

  return parseAmountInput(answer);
}

export async function runNoteFlow(session: InteractiveSession): Promise<void> {
  const pointOfSale = requirePointOfSale(session);

  if (!pointOfSale) {
    return;
  }

  const kind = await chooseOne('¿Que nota queres emitir?', [
    { name: 'Nota de credito (descuento, devolucion o anulacion)', value: 'credito' as const },
    { name: 'Nota de debito (cargo adicional)', value: 'debito' as const },
  ]);
  const invoiceKind = await chooseOne('¿Sobre que tipo de factura?', invoiceKindChoices());
  const spinner = startSpinner('Buscando las ultimas facturas en ARCA...');
  const invoices = await listRecentVouchers(session.historyGateway, pointOfSale, invoiceKind.arcaType).finally(() =>
    spinner?.stop(),
  );

  if (invoices.length === 0) {
    writeTerminalOutput(
      noticePanel(`No hay ${invoiceKind.displayName} emitidas en el punto de venta ${pointOfSale}.`, 'warning'),
    );

    return;
  }

  const invoice = await chooseOne(
    `¿Sobre que ${invoiceKind.displayName}?`,
    invoices.map((item) => ({
      description: item.cae ? `CAE ${item.cae}` : undefined,
      name: formatVoucherSummary(pointOfSale, item),
      value: item,
    })),
  );
  const documentType = resolveDocumentType(invoice.documentTypeCode);

  if (!documentType) {
    writeTerminalOutput(
      noticePanel(
        'La factura tiene un tipo de documento que el asistente no soporta. Usa los flags del CLI.',
        'warning',
      ),
    );

    return;
  }

  const noteKind = noteKindChoices(kind, invoiceKind);
  const totalAmount = await askNoteAmount(kind, invoice);
  const ivaCondition =
    documentType === 'consumidor-final'
      ? 'consumidor-final'
      : await chooseOne('Condicion frente al IVA del receptor:', ivaConditionChoices(invoiceKind.letter));
  const inferredRate = invoiceKind.letter === 'c' ? undefined : inferIvaRate(invoice.netAmount, invoice.ivaAmount);
  const ivaRate =
    invoiceKind.letter === 'c'
      ? undefined
      : (inferredRate ?? (await chooseOne('Alicuota de IVA de la factura:', ivaRateChoices())));
  const cancellation = noteKind.isElectronicCredit
    ? await confirm('¿El comprador rechazo la factura?', 'Si, es una nota de anulacion', 'No')
    : false;

  const input = billingCommandSchema.parse({
    associatedVoucher: {
      cuit: String(session.runtime.context.cuit),
      fecha: formatArcaDateAsArgentineDate(invoice.date),
      numero: invoice.number,
      puntoVenta: pointOfSale,
      shortcut: invoiceKind.shortcut,
    },
    cancellation,
    concept: CONCEPTS_BY_CODE[invoice.concept ?? 2] ?? 'servicios',
    documentNumber: documentType === 'consumidor-final' ? undefined : invoice.documentNumber,
    documentType,
    ivaCondition,
    ivaRate: ivaRate === '21' && !session.runtime.config.alicuotaPorDefecto ? undefined : ivaRate,
    shortcut: noteKind.shortcut,
    totalAmount,
  });

  await previewAndEmit(session, input);
}
