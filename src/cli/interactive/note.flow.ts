import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import {
  creditNoteOverTotalHint,
  describeAssociated,
  missingAssociatedWarning,
} from '../../modules/billing/billing.associated-lookup';
import { resolveRequiredCancellation } from '../../modules/billing/billing.associated-vouchers';
import { formatMoneyLabel } from '../../modules/billing/billing.labels';
import { formatVoucherLabel, formatVoucherWithArticle } from '../../modules/billing/billing.mappers';
import {
  type BillingCommandInput,
  billingCommandSchema,
  type BillingConcept,
} from '../../modules/billing/billing.schemas';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import { EXPORT_VOUCHER_KINDS, type ExportVoucherKind } from '../../modules/export/export.types';
import { amountInputText, parseAmountInput } from '../../modules/interactive/amount-input';
import {
  type AssociatedFamily,
  type AssociatedKind,
  associatedKindGroups,
  groupNewOptions,
} from '../../modules/interactive/associated-kinds';
import { conceptChoices, ivaRateChoices, noteKindChoices } from '../../modules/interactive/choices';
import {
  copyInvoiceAmounts,
  copyInvoiceReceiver,
  UNSUPPORTED_DOCUMENT_TYPE_NOTICE,
} from '../../modules/interactive/invoice-copy';
import { defaultIvaRate, explicitIvaRate } from '../../modules/interactive/iva-rate';
import {
  canChooseNoteCurrency,
  type NoteCurrency,
  noteCurrencyChoices,
  resolveNoteCurrency,
} from '../../modules/interactive/note-currency';
import { receiverDocumentNumber } from '../../modules/interactive/receiver-document';
import { BACK, type Back, requireStepValue, runWizard, type WizardStep } from '../../modules/interactive/wizard';
import type { IssuedVoucher } from '../../modules/vouchers/voucher-history';
import { formatVoucherNumber } from '../../modules/vouchers/voucher-history.presenter';
import { noticePanel, writeTerminalOutput } from '../../ui';

import {
  type AdvancedOptionKey,
  type AdvancedOptions,
  askAdvancedOptions,
  initialAdvancedOptions,
} from './advanced-options';
import { runExportNoteFlow } from './export-note.flow';
import { type OtherSystemInvoice, pickNoteInvoice } from './invoice-picker';
import { markIfNew } from './new-mark';
import { askTextStep, chooseStep } from './prompts';
import {
  askReceiverIvaCondition,
  type ReceiverFromPadron,
  receiverInputFields,
  receiverSteps,
} from './receiver-padron';
import { type InteractiveSession, previewAndEmit, requirePointOfSale } from './session';
import { validateAmount, validateDate } from './validators';

export type NoteKind = 'credito' | 'debito';

export interface NoteState {
  /** Fecha, fechas de servicio y vencimiento; en las de periodo, la moneda, y en las parciales, exento y no gravado. */
  readonly advanced?: AdvancedOptions;
  /** La fecha del asociado de otro sistema, que ARCA no tiene (`--afecha`). */
  readonly associatedDate?: string;
  readonly cancellation?: boolean;
  readonly concept?: BillingConcept;
  /** Sobre un comprobante en moneda extranjera: en esa moneda o en pesos (diferencia de cambio). */
  readonly currency?: NoteCurrency;
  readonly documentNumber?: number;
  readonly documentType?: BillingCommandInput['documentType'];
  /** Anula la factura entera: la nota copia exento y no gravado. */
  readonly annulsTotal?: boolean;
  /** Se eligio una factura E: el asistente de la nota E ya corrio y el resto de los pasos no aplica. */
  readonly exported?: boolean;
  readonly invoice?: IssuedVoucher;
  /** El tipo del asociado: una factura, un recibo u otra nota de la misma letra. */
  readonly invoiceKind?: VoucherKindDefinition;
  /** Punto de venta de la factura asociada; ingresada a mano puede no ser el configurado. */
  readonly invoicePointOfSale?: number;
  readonly ivaCondition?: BillingCommandInput['ivaCondition'];
  readonly receiver?: ReceiverFromPadron;
  readonly ivaRate?: BillingCommandInput['ivaRate'];
  /** Credito o debito: viene del menu principal. */
  readonly kind?: NoteKind;
  /**
   * El asociado ingresado a mano que ARCA no tiene, de un punto de venta que no es de web service (Comprobantes en
   * linea, controlador fiscal): no hay de donde copiar sus datos, asi que se preguntan como en una de periodo.
   */
  readonly otherSystemInvoice?: OtherSystemInvoice;
  readonly periodFrom?: string;
  readonly periodTo?: string;
  /** Sobre una factura de la lista o sobre un periodo (solo notas comunes). */
  readonly target?: 'factura' | 'periodo';
  readonly totalAmount?: number;
}

const isPeriod = (state: NoteState): boolean => state.target === 'periodo';

/** Sin factura de ARCA de donde copiar receptor, concepto, moneda y alicuota: una de periodo o una de otro sistema. */
const asksOwnData = (state: NoteState): boolean => isPeriod(state) || Boolean(state.otherSystemInvoice);

const NOTE_FAMILIES: ReadonlySet<VoucherKindDefinition['family']> = new Set([
  'nota-credito',
  'nota-debito',
  'nota-credito-electronica',
  'nota-debito-electronica',
]);

const CREDIT_NOTE_FAMILIES: ReadonlySet<VoucherKindDefinition['family']> = new Set([
  'nota-credito',
  'nota-credito-electronica',
]);

const isOverNote = (state: NoteState): boolean =>
  Boolean(state.invoiceKind && NOTE_FAMILIES.has(state.invoiceKind.family));

/** Como el CLI y la E: una NC no tiene tope ni se anula entera si ajusta otra NC. */
const isOverCreditNote = (state: NoteState): boolean =>
  Boolean(state.invoiceKind && CREDIT_NOTE_FAMILIES.has(state.invoiceKind.family));

/**
 * En FCE, la anulacion que exige el asociado: una nota sobre otra nota FCE es de anulacion, y una ND FCE sobre la
 * factura no lo es. Solo una NC FCE sobre la factura deja elegir.
 */
function requiredCancellation(state: NoteState): boolean | undefined {
  const invoiceKind = state.invoiceKind;

  if (!invoiceKind?.isElectronicCredit) {
    return undefined;
  }

  return resolveRequiredCancellation(noteKindChoices(state.kind ?? 'credito', invoiceKind).family, invoiceKind.family);
}

/**
 * "¿Sobre qué comprobante?" en dos niveles: la familia y, si tiene mas de una opcion, el comprobante. Volver desde el
 * segundo nivel vuelve a las familias; desde el primer paso de la nota E, a la lista donde estaba la E.
 */
async function askAssociatedKind(
  session: InteractiveSession,
  state: NoteState,
  previous?: AssociatedKind,
): Promise<Back | Pick<NoteState, 'exported' | 'invoiceKind' | 'target'>> {
  const kind = state.kind ?? 'credito';
  const groups = associatedKindGroups(kind);
  // Arranca en la primera opcion, o en la elegida antes; al volver de un nivel queda marcado lo que se habia elegido.
  let picked: AssociatedKind | undefined = previous;
  let family: AssociatedFamily | undefined = groups.find((group) =>
    group.options.some((option) => option.value === previous),
  )?.family;

  for (;;) {
    const chosen = await chooseStep(
      '¿Sobre qué comprobante?',
      groups.map((group) =>
        markIfNew({ description: group.description, name: group.name, value: group.family }, groupNewOptions(group)),
      ),
      family,
    );

    if (chosen === BACK) {
      return BACK;
    }

    family = chosen;
    const { options, question } = requireStepValue(
      groups.find((group) => group.family === chosen),
      'la familia del comprobante',
    );
    const only = options.length === 1 ? options[0]?.value : undefined;

    for (;;) {
      const value: AssociatedKind | Back =
        only ??
        (await chooseStep(
          question,
          options.map(({ newOption, ...option }) => (newOption ? markIfNew(option, newOption) : option)),
          picked,
        ));

      if (value === BACK) {
        break;
      }

      picked = value;

      if (!isExportKind(value)) {
        return { invoiceKind: value, target: 'factura' };
      }

      if ((await runExportNoteFlow(session, kind, value)) !== BACK) {
        return { exported: true };
      }

      // Sin segundo nivel, Volver desde la nota E vuelve a las familias.
      if (only) {
        break;
      }
    }
  }
}

function isExportKind(kind: ExportVoucherKind | VoucherKindDefinition): kind is ExportVoucherKind {
  return (EXPORT_VOUCHER_KINDS as readonly unknown[]).includes(kind);
}

/** `la factura C 00003-00000045`, para el aviso del tope de la NC. */
function describeInvoice(state: NoteState, invoice: IssuedVoucher): string {
  const name = state.invoiceKind ? formatVoucherWithArticle(state.invoiceKind) : 'el comprobante';

  return state.invoicePointOfSale === undefined
    ? name
    : `${name} ${formatVoucherNumber(state.invoicePointOfSale, invoice.number)}`;
}

/**
 * Opcionales que la nota no ofrece: la alicuota tiene su paso, la moneda es la de la factura o pesos (tiene su paso; en
 * los opcionales solo se elige en las de periodo) y, si anula el total, exento y no gravado se copian de la factura.
 */
function hiddenNoteOptions(state: NoteState): AdvancedOptionKey[] {
  return [
    'alicuota',
    'transferencia',
    ...(asksOwnData(state) ? [] : (['divisas'] as const)),
    ...(state.annulsTotal ? (['exento'] as const) : []),
  ];
}

/**
 * Una NC sobre una factura en su moneda puede anularla entera. Con varias alicuotas o tributos no se puede armar una
 * nota igual a la factura (solo parcial), y en pesos sobre un comprobante en otra moneda los totales no se comparan.
 */
function canAnnulTotal(state: NoteState): boolean {
  const invoice = state.invoice;

  return Boolean(
    state.kind === 'credito' &&
    invoice &&
    state.currency !== 'pesos' &&
    !isOverCreditNote(state) &&
    !copyInvoiceAmounts(invoice, state.invoiceKind?.letter ?? 'c').limitation,
  );
}

async function askAnnulScope(
  state: NoteState,
  previous?: boolean,
): Promise<Back | Pick<NoteState, 'annulsTotal' | 'totalAmount'>> {
  const invoice = requireStepValue(state.invoice, 'invoice');
  const scope = await chooseStep(
    '¿Total o parcial?',
    [
      { name: `Anular el total (${formatMoneyLabel(invoice.total, invoice.currency)})`, value: 'total' as const },
      { name: 'Parcial (ingresar monto)', value: 'parcial' as const },
    ],
    previous === undefined ? undefined : previous ? 'total' : 'parcial',
  );

  if (scope === BACK) {
    return BACK;
  }

  return scope === 'total' ? { annulsTotal: true, totalAmount: invoice.total } : { annulsTotal: false };
}

async function askNoteAmount(
  state: NoteState,
  previous?: number,
): Promise<Back | { readonly annulsTotal: boolean; readonly totalAmount: number | undefined }> {
  const invoice = state.invoice;
  const label = state.kind === 'debito' ? 'Monto de la nota de débito:' : 'Monto de la nota de crédito:';
  // En pesos sobre un comprobante en otra moneda los totales no se comparan: ni tope.
  const inInvoiceCurrency = state.currency !== 'pesos';
  const answer = await askTextStep(label, {
    previousAnswer: amountInputText(previous),
    validate: (value) => {
      const valid = validateAmount(value);

      if (valid !== true || state.kind !== 'credito' || !invoice || !inInvoiceCurrency || isOverCreditNote(state)) {
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
      run: (state, previous) => askAssociatedKind(session, state, previous?.invoiceKind),
    },
    {
      name: 'asociacion',
      run: async (state, previous) => {
        const target = await chooseStep(
          '¿A qué la asociamos?',
          [
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
          ],
          previous?.target,
        );

        return target === BACK ? BACK : { target };
      },
      // ARCA no acepta periodo asociado en notas FCE (10196); una nota sobre otra nota ya eligio el comprobante.
      skip: (state) => Boolean(state.invoiceKind?.isElectronicCredit) || isOverNote(state),
    },
    {
      name: 'factura',
      run: async (state, previous) => {
        const invoiceKind = requireStepValue(state.invoiceKind, 'invoiceKind');
        const previousNumber = previous?.invoice?.number ?? previous?.otherSystemInvoice?.number;
        const picked = await pickNoteInvoice(session, {
          message: `¿Sobre qué ${formatVoucherLabel(invoiceKind)}?`,
          pointOfSale,
          previous:
            previousNumber === undefined || previous?.invoicePointOfSale === undefined
              ? undefined
              : { number: previousNumber, pointOfSale: previous.invoicePointOfSale },
          voucherKind: invoiceKind,
        });

        if (picked === BACK) {
          return BACK;
        }

        if ('otherSystem' in picked) {
          return { invoice: undefined, invoicePointOfSale: picked.pointOfSale, otherSystemInvoice: picked };
        }

        const { invoice } = picked;
        const receiver = copyInvoiceReceiver(invoice);

        if (!receiver) {
          writeTerminalOutput(noticePanel(UNSUPPORTED_DOCUMENT_TYPE_NOTICE, 'warning'));

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
          ...receiver,
          currency: undefined,
          invoice,
          invoicePointOfSale: picked.pointOfSale,
          ivaRate: copy.ivaRate,
        };
      },
      skip: isPeriod,
    },
    {
      name: 'moneda',
      run: async (state, previous) => {
        const invoice = requireStepValue(state.invoice, 'invoice');
        const currency = await chooseStep(
          '¿En qué moneda va la nota?',
          noteCurrencyChoices(invoice),
          previous?.currency ?? state.currency,
        );

        return currency === BACK ? BACK : { currency };
      },
      // Solo sobre un comprobante en moneda extranjera; la de periodo elige la moneda en los opcionales.
      skip: (state) => isPeriod(state) || !canChooseNoteCurrency(state.invoice),
    },
    {
      name: 'fecha-asociado',
      run: async (state, previous) => {
        const invoiceKind = requireStepValue(state.invoiceKind, 'invoiceKind');
        const other = requireStepValue(state.otherSystemInvoice, 'otherSystemInvoice');
        const associatedDate = await askTextStep(
          `Fecha ${withPreposition(invoiceKind)} ${formatVoucherNumber(other.pointOfSale, other.number)}:`,
          { previousAnswer: previous?.associatedDate, validate: validateDate },
        );

        return associatedDate === BACK ? BACK : { associatedDate };
      },
      // ARCA la pide para controlador fiscal y FactuWeb (10211) y en FCE no se puede tomar de ARCA: siempre.
      skip: (state) => !state.otherSystemInvoice,
    },
    {
      name: 'periodo-desde',
      run: async (_state, previous) => {
        const periodFrom = await askTextStep('Período desde:', {
          previousAnswer: previous?.periodFrom,
          validate: validateDate,
        });

        return periodFrom === BACK ? BACK : { invoice: undefined, invoicePointOfSale: undefined, periodFrom };
      },
      skip: (state) => !isPeriod(state),
    },
    {
      name: 'periodo-hasta',
      run: async (_state, previous) => {
        const periodTo = await askTextStep('Período hasta:', {
          previousAnswer: previous?.periodTo,
          validate: validateDate,
        });

        return periodTo === BACK ? BACK : { periodTo };
      },
      skip: (state) => !isPeriod(state),
    },
    ...receiverSteps<NoteState>({
      letter: (state) => state.invoiceKind?.letter ?? 'c',
      message: () => '¿A quién va la nota?',
      skip: (state) => !asksOwnData(state),
    }),
    {
      name: 'concepto',
      run: async (_state, previous) => {
        const concept = await chooseStep(
          '¿Qué concepto ajusta la nota?',
          conceptChoices(),
          previous?.concept ?? config.conceptoPorDefecto,
        );

        return concept === BACK ? BACK : { concept };
      },
      skip: (state) => !asksOwnData(state),
    },
    {
      name: 'alcance',
      run: (state, previous) => askAnnulScope(state, previous?.annulsTotal),
      skip: (state) => !canAnnulTotal(state),
    },
    {
      name: 'monto',
      run: (state, previous) => askNoteAmount(state, previous?.totalAmount),
      skip: (state) => state.annulsTotal === true,
    },
    {
      name: 'iva-receptor',
      run: async (state, previous) => {
        // ARCA no devuelve la condicion IVA de la factura, asi que se pregunta, filtrada por la letra.
        return askReceiverIvaCondition(
          session,
          state,
          state.invoiceKind?.letter ?? 'c',
          config.ivaReceptorPorDefecto,
          previous?.ivaCondition,
        );
      },
      skip: (state) => state.documentType === 'consumidor-final',
    },
    {
      name: 'alicuota',
      run: async (state, previous) => {
        const ivaRate = await chooseStep(
          asksOwnData(state) ? 'Alícuota de IVA:' : 'Alícuota de IVA del comprobante:',
          ivaRateChoices(),
          // La elegida antes, la deducida de la factura o, como el CLI sin `--alicuota`, la de la config o 21%.
          previous?.ivaRate ?? defaultIvaRate(config, state.ivaRate),
        );

        return ivaRate === BACK ? BACK : { ivaRate };
      },
      // En la C no hay IVA; si la factura deja deducir la alicuota, no se pregunta.
      skip: (state) => state.invoiceKind?.letter === 'c' || (!asksOwnData(state) && Boolean(state.ivaRate)),
    },
    {
      name: 'anulacion',
      run: async (_state, previous) => {
        const cancellation = await chooseStep(
          '¿El comprador rechazó la factura?',
          [
            { name: 'Sí, es una nota de anulación', value: true },
            { name: 'No', value: false },
          ],
          previous?.cancellation,
        );

        return cancellation === BACK ? BACK : { cancellation };
      },
      // Solo pregunta si el asociado deja elegir (una NC FCE sobre la factura).
      skip: (state) => !state.invoiceKind?.isElectronicCredit || requiredCancellation(state) !== undefined,
    },
    {
      name: 'avanzadas',
      run: async (state) => {
        const invoiceKind = requireStepValue(state.invoiceKind, 'invoiceKind');
        const advanced = await askAdvancedOptions(state.advanced ?? initialAdvancedOptions(config), {
          concept: state.concept ?? 'servicios',
          defaultIvaRate: defaultIvaRate(config, state.ivaRate),
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
  // Una nota va en la moneda de su factura o en pesos; si la anula entera, tambien copia exento y no gravado.
  const copy = !isPeriod(state) && invoice ? copyInvoiceAmounts(invoice, invoiceKind.letter) : undefined;
  const advanced = state.advanced ?? initialAdvancedOptions(session.runtime.config);
  // La de periodo o de otro sistema no tiene factura de donde copiar la moneda: va la elegida en los opcionales.
  const currency = asksOwnData(state)
    ? { currencyCode: advanced.currencyCode, exchangeRate: advanced.exchangeRate, sameCurrency: advanced.sameCurrency }
    : resolveNoteCurrency(copy, state.currency);

  return billingCommandSchema.parse({
    ...currency,
    associatedPeriod: isPeriod(state) ? { desde: state.periodFrom, hasta: state.periodTo } : undefined,
    associatedVoucher: state.otherSystemInvoice
      ? {
          cuit: String(session.runtime.context.cuit),
          fecha: state.associatedDate,
          numero: state.otherSystemInvoice.number,
          puntoVenta: state.otherSystemInvoice.pointOfSale,
          shortcut: invoiceKind.shortcut,
        }
      : !isPeriod(state) && invoice
        ? {
            cuit: String(session.runtime.context.cuit),
            fecha: formatArcaDateAsArgentineDate(invoice.date),
            numero: invoice.number,
            puntoVenta: state.invoicePointOfSale ?? pointOfSale,
            shortcut: invoiceKind.shortcut,
          }
        : undefined,
    billingDate: advanced.billingDate,
    cancellation: requiredCancellation(state) ?? state.cancellation ?? false,
    concept: state.concept,
    documentNumber: receiverDocumentNumber(state),
    documentType: state.documentType,
    exemptAmount: state.annulsTotal ? copy?.exemptAmount : advanced.exemptAmount,
    ivaCondition: state.ivaCondition,
    ...receiverInputFields(state),
    ivaRate: explicitIvaRate(state.ivaRate, session.runtime.config),
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
  // La moneda de los opcionales solo se usa en las de periodo; las de una factura van en la de la factura o en pesos.
  const state = await runWizard(noteSteps(session, pointOfSale), {
    advanced: initialAdvancedOptions(session.runtime.config),
    kind,
  });

  if (!state || state.exported) {
    return;
  }

  await previewAndEmit(session, buildNoteInput(state, session, pointOfSale), noteWarnings(state));
}

/** `de la factura C`, `del recibo C`: para "Fecha de…". */
function withPreposition(invoiceKind: VoucherKindDefinition): string {
  const named = formatVoucherWithArticle(invoiceKind);

  return named.startsWith('el ') ? `del ${named.slice(3)}` : `de ${named}`;
}

/**
 * Los avisos de la vista previa que el asistente sabe y `previewAndEmit` no: el de un asociado de otro sistema, con
 * el mismo texto que con flags (`checkAssociatedInArca`).
 */
export function noteWarnings(state: NoteState): string[] {
  const other = state.otherSystemInvoice;
  const invoiceKind = state.invoiceKind;

  if (!other || !invoiceKind) {
    return [];
  }

  return [
    missingAssociatedWarning({
      hasDate: Boolean(state.associatedDate),
      isCreditNote: state.kind !== 'debito',
      label: describeAssociated(invoiceKind.arcaType, other.pointOfSale, other.number),
      origin: other.origin,
      pointOfSale: other.pointOfSale,
    }),
  ];
}
