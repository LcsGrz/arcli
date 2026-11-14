import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { parseStrictInteger } from '../../lib/numbers/strict-integer';
import { creditNoteOverTotalHint } from '../../modules/billing/billing.associated-lookup';
import { formatMoneyLabel } from '../../modules/billing/billing.labels';
import { formatVoucherLabel, formatVoucherWithArticle } from '../../modules/billing/billing.mappers';
import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_DEBIT_NOTE_KIND,
  EXPORT_VOUCHER_KIND,
  type ExportGateway,
  type ExportIssuedVoucher,
  type ExportVoucherInput,
} from '../../modules/export/export.types';
import { parseAmountInput } from '../../modules/interactive/amount-input';
import { BACK, requireStepValue, runWizard, type WizardStep } from '../../modules/interactive/wizard';
import { formatVoucherNumber } from '../../modules/vouchers/voucher-history.presenter';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { noticePanel, writeTerminalOutput } from '../../ui';
import { withSpinner } from '../spinner';

import { askPermitsStep, emitExportVoucher } from './export.flow';
import { askTextStep } from './prompts';
import { type InteractiveSession, requirePointOfSale } from './session';
import { validateAmount } from './validators';

export interface ExportNoteState {
  readonly amount?: number;
  readonly description?: string;
  readonly invoice?: ExportIssuedVoucher;
  readonly invoicePointOfSale?: number;
  readonly permits?: readonly string[];
}

function validatePositiveInteger(label: string): (value: string) => string | true {
  return (value) => {
    const number = parseStrictInteger(value);

    return number !== undefined && number >= 1 ? true : `${label} tiene que ser un número entero positivo.`;
  };
}

/** "Factura de exportación E 00004-00000001 del 30/10/2026 a ACME LLC, por 1.500 USD". */
function describeInvoice(invoice: ExportIssuedVoucher): string {
  return `${EXPORT_VOUCHER_KIND.displayName} ${formatVoucherNumber(invoice.pointOfSale, invoice.number)} del ${formatArcaDateAsArgentineDate(invoice.date)} a ${invoice.clientName}, por ${formatMoneyLabel(invoice.total, invoice.currencyCode)}.`;
}

/**
 * Pasos de la nota E: la factura que ajusta (se busca en ARCA y de ahi salen cliente, destino y moneda), el monto,
 * el detalle y, en bienes, los permisos de embarque. Cada uno se puede deshacer con "Volver".
 */
export function exportNoteSteps(
  kind: 'credito' | 'debito',
  gateway: Pick<ExportGateway, 'getVoucher'>,
  pointOfSale: number,
): Array<WizardStep<ExportNoteState>> {
  const voucherKind = kind === 'credito' ? EXPORT_CREDIT_NOTE_KIND : EXPORT_DEBIT_NOTE_KIND;

  return [
    {
      name: 'punto-venta-factura',
      run: async () => {
        const answer = await askTextStep('Punto de venta de la factura E:', {
          defaultValue: String(pointOfSale),
          validate: validatePositiveInteger('El punto de venta'),
        });

        return answer === BACK ? BACK : { invoicePointOfSale: parseStrictInteger(answer) };
      },
    },
    {
      name: 'factura',
      run: async (state) => {
        const invoicePointOfSale = requireStepValue(state.invoicePointOfSale, 'invoicePointOfSale');

        // Se vuelve a preguntar hasta que ARCA tenga la factura, o hasta "Volver".
        for (;;) {
          const answer = await askTextStep('Número de la factura E:', {
            validate: validatePositiveInteger('El número'),
          });

          if (answer === BACK) {
            return BACK;
          }

          const number = parseStrictInteger(answer) as number;
          const invoice = await withSpinner('Buscando la factura E en ARCA...', () =>
            gateway.getVoucher({ arcaType: EXPORT_VOUCHER_KIND.arcaType, number, pointOfSale: invoicePointOfSale }),
          );

          if (invoice) {
            writeTerminalOutput(noticePanel(describeInvoice(invoice), 'info'));

            return { invoice };
          }

          writeTerminalOutput(
            noticePanel(
              `ARCA no tiene la factura E ${formatVoucherNumber(invoicePointOfSale, number)}. Revisá el número o el punto de venta.`,
              'warning',
            ),
          );
        }
      },
    },
    {
      name: 'monto',
      run: async (state) => {
        const invoice = requireStepValue(state.invoice, 'invoice');
        const answer = await askTextStep(`Monto de la ${formatVoucherLabel(voucherKind)} (${invoice.currencyCode}):`, {
          validate: (value) => {
            const valid = validateAmount(value);

            if (valid !== true || kind !== 'credito') {
              return valid;
            }

            return (parseAmountInput(value) ?? 0) <= invoice.total
              ? true
              : creditNoteOverTotalHint(
                  `${formatVoucherWithArticle(EXPORT_VOUCHER_KIND)} ${formatVoucherNumber(invoice.pointOfSale, invoice.number)}`,
                  invoice.total,
                  invoice.currencyCode,
                );
          },
        });

        return answer === BACK ? BACK : { amount: parseAmountInput(answer) };
      },
    },
    {
      name: 'descripcion',
      run: async () => {
        const answer = await askTextStep('Detalle de la nota (Enter para "Según detalle"):');

        return answer === BACK ? BACK : { description: answer.trim() || undefined };
      },
    },
    {
      // Solo en bienes: los permisos son opcionales en la nota y van sin `--permiso-existente` (tabla de la 1720).
      name: 'permisos',
      run: askPermitsStep,
      skip: (state) => state.invoice?.exportType !== 1,
    },
  ];
}

export function buildExportNoteInput(kind: 'credito' | 'debito', state: ExportNoteState): ExportVoucherInput {
  const invoice = requireStepValue(state.invoice, 'invoice');

  return {
    amount: state.amount,
    associatedVoucher: { number: invoice.number, pointOfSale: invoice.pointOfSale },
    description: state.description,
    emit: false,
    permits: state.permits,
    voucherKind: kind === 'credito' ? EXPORT_CREDIT_NOTE_KIND : EXPORT_DEBIT_NOTE_KIND,
  };
}

/**
 * Nota de credito o debito E paso a paso. Usa ExportService igual que `arcli nce` y `arcli nde`. Devuelve BACK si se
 * vuelve desde el primer paso, para volver al selector de comprobantes.
 */
export async function runExportNoteFlow(
  session: InteractiveSession,
  kind: 'credito' | 'debito',
): Promise<typeof BACK | void> {
  const pointOfSale = requirePointOfSale(session);

  if (!pointOfSale) {
    return;
  }

  const gateway = new ArcaClientFactory().createExportGateway(session.runtime);
  const state = await runWizard(exportNoteSteps(kind, gateway, pointOfSale), {});

  if (!state) {
    return BACK;
  }

  await emitExportVoucher(session, gateway, buildExportNoteInput(kind, state));
}
