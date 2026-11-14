import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { DEFAULT_IVA_RATE } from '../../modules/billing/billing.amounts';
import { creditNoteOverTotalHint } from '../../modules/billing/billing.associated-lookup';
import { formatMoneyLabel } from '../../modules/billing/billing.labels';
import { formatVoucherLabel, formatVoucherWithArticle } from '../../modules/billing/billing.mappers';
import {
  type BillingCommandInput,
  billingCommandSchema,
  type BillingConcept,
} from '../../modules/billing/billing.schemas';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import { EXPORT_VOUCHER_KIND, type ExportVoucherKind } from '../../modules/export/export.types';
import { parseAmountInput } from '../../modules/interactive/amount-input';
import {
  conceptChoices,
  exportInvoiceChoice,
  invoiceKindChoices,
  ivaRateChoices,
  noteKindChoices,
  receiverChoices,
  reciboChoice,
} from '../../modules/interactive/choices';
import { copyInvoiceAmounts } from '../../modules/interactive/invoice-copy';
import { BACK, type Back, requireStepValue, runWizard, type WizardStep } from '../../modules/interactive/wizard';
import { type IssuedVoucher, resolveDocumentType } from '../../modules/vouchers/voucher-history';
import { formatVoucherNumber } from '../../modules/vouchers/voucher-history.presenter';
import { noticePanel, writeTerminalOutput } from '../../ui';

import {
  type AdvancedOptionKey,
  type AdvancedOptions,
  askAdvancedOptions,
  initialAdvancedOptions,
} from './advanced-options';
import { runExportNoteFlow } from './export-note.flow';
import { pickInvoice } from './invoice-picker';
import { markIfNew } from './new-mark';
import { askTextStep, chooseStep } from './prompts';
import {
  askDocumentNumber,
  askReceiverIvaCondition,
  type ReceiverFromPadron,
  receiverInputFields,
} from './receiver-padron';
import { type InteractiveSession, previewAndEmit, requirePointOfSale } from './session';
import { normalizeDocumentNumber, validateAmount, validateDate } from './validators';

const CONCEPTS_BY_CODE: Record<number, BillingConcept> = {
  1: 'productos',
  2: 'servicios',
  3: 'productos-servicios',
};

export type NoteKind = 'credito' | 'debito';

export interface NoteState {
  /** Fecha, fechas de servicio y vencimiento; en las de periodo, la moneda, y en las parciales, exento y no gravado. */
  readonly advanced?: AdvancedOptions;
  readonly cancellation?: boolean;
  readonly concept?: BillingConcept;
  readonly documentNumber?: number;
  readonly documentType?: BillingCommandInput['documentType'];
  /** Anula la factura entera: la nota copia exento y no gravado. */
  readonly annulsTotal?: boolean;
  /** Se eligio una factura E: el asistente de la nota E ya corrio y el resto de los pasos no aplica. */
  readonly exported?: boolean;
  readonly invoice?: IssuedVoucher;
  readonly invoiceKind?: VoucherKindDefinition;
  /** Punto de venta de la factura asociada; ingresada a mano puede no ser el configurado. */
  readonly invoicePointOfSale?: number;
  readonly ivaCondition?: BillingCommandInput['ivaCondition'];
  readonly receiver?: ReceiverFromPadron;
  readonly ivaRate?: BillingCommandInput['ivaRate'];
  /** Credito o debito: viene del menu principal. */
  readonly kind?: NoteKind;
  readonly periodFrom?: string;
  readonly periodTo?: string;
  /** Sobre una factura de la lista o sobre un periodo (solo notas comunes). */
  readonly target?: 'factura' | 'periodo';
  readonly totalAmount?: number;
}

const isPeriod = (state: NoteState): boolean => state.target === 'periodo';

/** `la factura C 00003-00000045`, para el aviso del tope de la NC. */
function describeInvoice(state: NoteState, invoice: IssuedVoucher): string {
  const name = state.invoiceKind ? formatVoucherWithArticle(state.invoiceKind) : 'el comprobante';

  return state.invoicePointOfSale === undefined
    ? name
    : `${name} ${formatVoucherNumber(state.invoicePointOfSale, invoice.number)}`;
}

/**
 * Opcionales que la nota no ofrece: la alicuota tiene su paso, la moneda es la de la factura (solo se elige en las de
 * periodo) y, si anula el total, exento y no gravado se copian de la factura.
 */
function hiddenNoteOptions(state: NoteState): AdvancedOptionKey[] {
  return [
    'alicuota',
    'transferencia',
    ...(isPeriod(state) ? [] : (['divisas'] as const)),
    ...(state.annulsTotal ? (['exento'] as const) : []),
  ];
}

async function askNoteAmount(
  state: NoteState,
): Promise<Back | { readonly annulsTotal: boolean; readonly totalAmount: number | undefined }> {
  const invoice = state.invoice;
  const label = state.kind === 'debito' ? 'Monto de la nota de débito:' : 'Monto de la nota de crédito:';
  // Con varias alicuotas o tributos no se puede armar una nota igual a la factura: solo parcial.
  const canAnnulTotal = Boolean(invoice && !copyInvoiceAmounts(invoice, state.invoiceKind?.letter ?? 'c').limitation);

  if (state.kind === 'credito' && invoice && canAnnulTotal) {
    const scope = await chooseStep('¿Total o parcial?', [
      { name: `Anular el total (${formatMoneyLabel(invoice.total, invoice.currency)})`, value: 'total' as const },
      { name: 'Parcial (ingresar monto)', value: 'parcial' as const },
    ]);

    if (scope === BACK || scope === 'total') {
      return scope === BACK ? BACK : { annulsTotal: true, totalAmount: invoice.total };
    }
  }

  const answer = await askTextStep(label, {
    validate: (value) => {
      const valid = validateAmount(value);

      if (valid !== true || state.kind !== 'credito' || !invoice) {
        return valid;
      }

      return (parseAmountInput(value) ?? 0) <= invoice.total
        ? true
        : creditNoteOverTotalHint(describeInvoice(state, invoice), invoice.total, invoice.currency);
    },
  });

  return answer === BACK ? BACK : { annulsTotal: false, totalAmount: parseAmountInput(answer) };
}

/** Pasos del flujo de notas; cada uno se puede deshacer con "Volver". */
export function noteSteps(session: InteractiveSession, pointOfSale: number): Array<WizardStep<NoteState>> {
  const { config } = session.runtime;
  const steps: Array<WizardStep<NoteState>> = [
    {
      name: 'tipo-factura',
      run: async (state) => {
        // Volver desde el primer paso de la nota E vuelve a este selector.
        for (;;) {
          const invoiceKind = await chooseStep<ExportVoucherKind | VoucherKindDefinition>('¿Sobre qué comprobante?', [
            ...invoiceKindChoices(),
            markIfNew(reciboChoice(), 'recibo'),
            markIfNew(exportInvoiceChoice(), 'notas-e'),
          ]);

          if (invoiceKind === BACK) {
            return BACK;
          }

          if (invoiceKind !== EXPORT_VOUCHER_KIND) {
            return { invoiceKind: invoiceKind as VoucherKindDefinition, target: 'factura' };
          }

          if ((await runExportNoteFlow(session, state.kind ?? 'credito')) !== BACK) {
            return { exported: true };
          }
        }
      },
    },
    {
      name: 'asociacion',
      run: async (state) => {
        const target = await chooseStep('¿A qué la asociamos?', [
          {
            description: 'Elegís una de las últimas emitidas o la ingresás a mano',
            name: state.invoiceKind?.family === 'recibo' ? 'A un recibo' : 'A una factura',
            value: 'factura' as const,
          },
          {
            description: 'Por ejemplo, un descuento sobre todo el mes',
            name: 'A un período',
            value: 'periodo' as const,
          },
        ]);

        return target === BACK ? BACK : { target };
      },
      // ARCA no acepta periodo asociado en notas FCE (10196).
      skip: (state) => Boolean(state.invoiceKind?.isElectronicCredit),
    },
    {
      name: 'factura',
      run: async (state) => {
        const invoiceKind = requireStepValue(state.invoiceKind, 'invoiceKind');
        const picked = await pickInvoice(session, {
          message: `¿Sobre qué ${formatVoucherLabel(invoiceKind)}?`,
          pointOfSale,
          voucherKind: invoiceKind,
        });

        if (picked === BACK) {
          return BACK;
        }

        const { invoice } = picked;
        const documentType = resolveDocumentType(invoice.documentTypeCode);

        if (!documentType) {
          writeTerminalOutput(
            noticePanel(
              'El comprobante tiene un tipo de documento que el asistente no soporta. Usá los flags del CLI.',
              'warning',
            ),
          );

          return BACK;
        }

        const copy = copyInvoiceAmounts(invoice, invoiceKind.letter);

        if (copy.limitation) {
          writeTerminalOutput(
            noticePanel(`${copy.limitation} La nota solo puede ser parcial; revisá la alícuota.`, 'warning'),
          );
        }

        // La nota hereda de la factura el receptor, el concepto, la moneda y la alicuota (si se puede deducir).
        return {
          concept: CONCEPTS_BY_CODE[invoice.concept ?? 2] ?? 'servicios',
          documentNumber: documentType === 'consumidor-final' ? undefined : invoice.documentNumber,
          documentType,
          invoice,
          invoicePointOfSale: picked.pointOfSale,
          ivaCondition: documentType === 'consumidor-final' ? 'consumidor-final' : undefined,
          ivaRate: copy.ivaRate,
        };
      },
      skip: isPeriod,
    },
    {
      name: 'periodo',
      run: async () => {
        const periodFrom = await askTextStep('Período desde:', { validate: validateDate });

        if (periodFrom === BACK) {
          return BACK;
        }

        const periodTo = await askTextStep('Período hasta:', { validate: validateDate });

        return periodTo === BACK ? BACK : { invoice: undefined, invoicePointOfSale: undefined, periodFrom, periodTo };
      },
      skip: (state) => !isPeriod(state),
    },
    {
      name: 'receptor',
      run: async (state) => {
        const documentType = await chooseStep(
          '¿A quién va la nota?',
          receiverChoices(state.invoiceKind?.letter ?? 'c'),
        );

        return documentType === BACK
          ? BACK
          : {
              documentNumber: undefined,
              documentType,
              ivaCondition: documentType === 'consumidor-final' ? 'consumidor-final' : undefined,
            };
      },
      skip: (state) => !isPeriod(state),
    },
    {
      name: 'documento',
      run: async (state) => {
        const answer = await askDocumentNumber(state.documentType);

        return answer === BACK ? BACK : { documentNumber: normalizeDocumentNumber(answer) };
      },
      skip: (state) => !isPeriod(state) || state.documentType === 'consumidor-final',
    },
    {
      name: 'concepto',
      run: async () => {
        const concept = await chooseStep('¿Qué concepto ajusta la nota?', conceptChoices(), config.conceptoPorDefecto);

        return concept === BACK ? BACK : { concept };
      },
      skip: (state) => !isPeriod(state),
    },
    {
      name: 'monto',
      run: async (state) => {
        const amount = await askNoteAmount(state);

        return amount === BACK ? BACK : amount;
      },
    },
    {
      name: 'iva-receptor',
      run: async (state) => {
        // ARCA no devuelve la condicion IVA de la factura, asi que se pregunta, filtrada por la letra.
        return askReceiverIvaCondition(session, state, state.invoiceKind?.letter ?? 'c', config.ivaReceptorPorDefecto);
      },
      skip: (state) => state.documentType === 'consumidor-final',
    },
    {
      name: 'alicuota',
      run: async (state) => {
        const ivaRate = await chooseStep(
          isPeriod(state) ? 'Alícuota de IVA:' : 'Alícuota de IVA del comprobante:',
          ivaRateChoices(),
          // Como el CLI sin `--alicuota`: la de la config o 21%.
          state.ivaRate ?? config.alicuotaPorDefecto ?? DEFAULT_IVA_RATE,
        );

        return ivaRate === BACK ? BACK : { ivaRate };
      },
      // En la C no hay IVA; si la factura deja deducir la alicuota, no se pregunta.
      skip: (state) => state.invoiceKind?.letter === 'c' || (!isPeriod(state) && Boolean(state.ivaRate)),
    },
    {
      name: 'anulacion',
      run: async () => {
        const cancellation = await chooseStep('¿El comprador rechazó la factura?', [
          { name: 'Sí, es una nota de anulación', value: true },
          { name: 'No', value: false },
        ]);

        return cancellation === BACK ? BACK : { cancellation };
      },
      skip: (state) => !state.invoiceKind?.isElectronicCredit,
    },
    {
      name: 'avanzadas',
      run: async (state) => {
        const invoiceKind = requireStepValue(state.invoiceKind, 'invoiceKind');
        const advanced = await askAdvancedOptions(state.advanced ?? initialAdvancedOptions(config), {
          concept: state.concept ?? 'servicios',
          defaultIvaRate: state.ivaRate ?? DEFAULT_IVA_RATE,
          hidden: hiddenNoteOptions(state),
          voucherKind: noteKindChoices(state.kind ?? 'credito', invoiceKind),
        });

        return advanced === BACK ? BACK : { advanced };
      },
    },
  ];

  // La nota E tiene su propio asistente: despues del selector, ningun paso de A, B y C aplica.
  return steps.map((step, index) =>
    index === 0 ? step : { ...step, skip: (state) => Boolean(state.exported) || Boolean(step.skip?.(state)) },
  );
}

/** Arma la entrada del CLI con lo que respondio el usuario. */
export function buildNoteInput(
  state: NoteState,
  session: InteractiveSession,
  pointOfSale: number,
): BillingCommandInput {
  const invoiceKind = requireStepValue(state.invoiceKind, 'invoiceKind');
  const noteKind = noteKindChoices(state.kind ?? 'credito', invoiceKind);
  const invoice = state.invoice;
  // Una nota va en la moneda de su factura; si la anula entera, tambien copia exento y no gravado.
  const copy = !isPeriod(state) && invoice ? copyInvoiceAmounts(invoice, invoiceKind.letter) : undefined;
  const advanced = state.advanced ?? initialAdvancedOptions(session.runtime.config);
  // La de periodo no tiene factura de donde copiar la moneda: va la elegida en los opcionales.
  const currency = isPeriod(state)
    ? { currencyCode: advanced.currencyCode, exchangeRate: advanced.exchangeRate, sameCurrency: advanced.sameCurrency }
    : { currencyCode: copy?.currencyCode, exchangeRate: copy?.exchangeRate };

  return billingCommandSchema.parse({
    ...currency,
    associatedPeriod: isPeriod(state) ? { desde: state.periodFrom, hasta: state.periodTo } : undefined,
    associatedVoucher:
      !isPeriod(state) && invoice
        ? {
            cuit: String(session.runtime.context.cuit),
            fecha: formatArcaDateAsArgentineDate(invoice.date),
            numero: invoice.number,
            puntoVenta: state.invoicePointOfSale ?? pointOfSale,
            shortcut: invoiceKind.shortcut,
          }
        : undefined,
    billingDate: advanced.billingDate,
    cancellation: state.cancellation ?? false,
    concept: state.concept,
    documentNumber: state.documentType === 'consumidor-final' ? undefined : state.documentNumber,
    documentType: state.documentType,
    exemptAmount: state.annulsTotal ? copy?.exemptAmount : advanced.exemptAmount,
    ivaCondition: state.ivaCondition,
    ...receiverInputFields(state),
    ivaRate:
      state.ivaRate === DEFAULT_IVA_RATE && !session.runtime.config.alicuotaPorDefecto ? undefined : state.ivaRate,
    shortcut: noteKind.shortcut,
    paymentDueDate: advanced.paymentDueDate,
    serviceEndDate: advanced.serviceEndDate,
    serviceStartDate: advanced.serviceStartDate,
    totalAmount: state.totalAmount,
    untaxedAmount: state.annulsTotal ? copy?.untaxedAmount : advanced.untaxedAmount,
  });
}

export async function runNoteFlow(baseSession: InteractiveSession, kind: NoteKind): Promise<void> {
  const ready = await requirePointOfSale(baseSession);

  if (!ready) {
    return;
  }

  const { pointOfSale, session } = ready;
  // La moneda solo se usa en las de periodo; las de una factura van en la de la factura.
  const state = await runWizard(noteSteps(session, pointOfSale), {
    advanced: initialAdvancedOptions(session.runtime.config),
    kind,
  });

  if (!state || state.exported) {
    return;
  }

  await previewAndEmit(session, buildNoteInput(state, session, pointOfSale));
}
