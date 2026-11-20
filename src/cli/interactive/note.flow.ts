import { formatDateAsArcaDate } from '../../lib/dates/arca-date';
import {
  creditNoteOverTotalHint,
  describeAssociated,
  missingAssociatedWarning,
} from '../../modules/billing/billing.associated-lookup';
import { formatMoneyLabel } from '../../modules/billing/billing.labels';
import { formatVoucherLabel, formatVoucherWithArticle } from '../../modules/billing/billing.mappers';
import { BILLING_RULES } from '../../modules/billing/billing.rules';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import { EXPORT_VOUCHER_KINDS, type ExportVoucherKind } from '../../modules/export/export.types';
import { amountInputText, parseAmountInput } from '../../modules/interactive/amount-input';
import {
  type AssociatedFamily,
  type AssociatedKind,
  associatedKindGroups,
  groupNewOptions,
} from '../../modules/interactive/associated-kinds';
import {
  type AdvancedOptionKey,
  type AdvancedOptions,
  type BillingRuleScope,
  initialAdvancedOptions,
} from '../../modules/interactive/billing-optionals';
import { conceptChoices, ivaRateChoices, noteKindChoices } from '../../modules/interactive/choices';
import { isConsumerIdentified } from '../../modules/interactive/consumer-identification';
import { completeDateInput } from '../../modules/interactive/date-input';
import {
  copyInvoiceAmounts,
  copyInvoiceReceiver,
  UNSUPPORTED_DOCUMENT_TYPE_NOTICE,
} from '../../modules/interactive/invoice-copy';
import { defaultIvaRate } from '../../modules/interactive/iva-rate';
import { canChooseNoteCurrency, noteCurrencyChoices } from '../../modules/interactive/note-currency';
import {
  asksOwnNoteData,
  buildNoteInput,
  isPeriodNote,
  noteCurrency,
  noteFinalize,
  type NoteInputEnv,
  type NoteKind,
  type NoteRuleEnv,
  noteRuleScope,
  noteRuleValidator,
  type NoteState,
  requiredNoteCancellation,
} from '../../modules/interactive/note-input';
import { scopedRuleValidator } from '../../modules/interactive/rule-validator';
import { BACK, type Back, requireStepValue, runWizard, type WizardStep } from '../../modules/interactive/wizard';
import type { IssuedVoucher } from '../../modules/vouchers/voucher-history';
import { formatVoucherNumber } from '../../modules/vouchers/voucher-history.presenter';
import { noticePanel, writeTerminalOutput } from '../../ui';

import { billingOptionalsStep } from './advanced-options';
import { requiredConsumerSteps } from './consumer-identification';
import { runExportNoteFlow } from './export-note.flow';
import { withFinalizeNotice } from './finalize-notice';
import { pickNoteInvoice } from './invoice-picker';
import { markIfNew } from './new-mark';
import { exchangeRateSuggestionLoader, officialExchangeRateLoader } from './official-exchange-rate';
import { askTextStep, chooseStep } from './prompts';
import { askReceiverIvaCondition, receiverSteps } from './receiver-padron';
import { type InteractiveSession, previewAndEmit, requirePointOfSale } from './session';
import { validateAmount, validateDate } from './validators';

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
    // Sobre un comprobante, la moneda y el receptor son los suyos.
    ...(asksOwnNoteData(state) ? [] : (['divisas', 'consumidor'] as const)),
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
  previous: number | undefined,
  rules: BillingRuleScope,
): Promise<Back | { readonly annulsTotal: boolean; readonly totalAmount: number | undefined }> {
  const invoice = state.invoice;
  const label = state.kind === 'debito' ? 'Monto de la nota de débito:' : 'Monto de la nota de crédito:';
  // En pesos sobre un comprobante en otra moneda los totales no se comparan: ni tope.
  const inInvoiceCurrency = state.currency !== 'pesos';
  const validate = (value: string): string | true => {
    const valid = validateAmount(value);

    if (valid !== true || state.kind !== 'credito' || !invoice || !inInvoiceCurrency || isOverCreditNote(state)) {
      return valid;
    }

    return (parseAmountInput(value) ?? 0) <= invoice.total
      ? true
      : creditNoteOverTotalHint(describeInvoice(state, invoice), invoice.total, invoice.currency);
  };
  const answer = await askTextStep(label, {
    previousAnswer: amountInputText(previous),
    validate: scopedRuleValidator(
      BILLING_RULES,
      'totalAmount',
      rules,
      (value) => ({ totalAmount: parseAmountInput(value) }),
      validate,
    ),
  });

  return answer === BACK ? BACK : { annulsTotal: false, totalAmount: parseAmountInput(answer) };
}

/** Pasos del flujo de notas; cada uno se puede deshacer con "Volver". */
export function noteSteps(session: InteractiveSession, pointOfSale: number): Array<WizardStep<NoteState>> {
  const { config } = session.runtime;
  const officialExchangeRate = officialExchangeRateLoader(session);
  const exchangeRateSuggestion = exchangeRateSuggestionLoader(config, officialExchangeRate);
  const advancedOf = (state: NoteState): AdvancedOptions => state.advanced ?? initialAdvancedOptions(config);
  const ruleEnv = () => noteRuleEnv(session, pointOfSale);
  const rules = (state: NoteState) => noteRuleScope(state, ruleEnv());
  const noteRule = (
    field: string,
    validate: (value: string) => string | true,
    answer: (value: string) => Partial<NoteState>,
  ) => noteRuleValidator(ruleEnv, field, validate, answer);
  // El receptor sale de la factura o se pregunta: si cambia, el documento escrito antes no se ofrece.
  const consumerOptions = {
    advanced: advancedOf,
    amount: (state: NoteState) => ({
      ...noteCurrency(state, advancedOf(state)),
      billingDate: advancedOf(state).billingDate,
      totalAmount: state.totalAmount,
    }),
    dependsOn: ['factura', 'receptor'],
  };
  const steps: Array<WizardStep<NoteState>> = [
    {
      name: 'tipo-factura',
      run: (state, previous) => askAssociatedKind(session, state, previous?.invoiceKind),
    },
    {
      // "A una factura" o "A un recibo", segun el asociado.
      dependsOn: ['tipo-factura'],
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
              // No "todo el mes": el periodo no puede terminar despues de la fecha de la nota (10208, REV-71).
              description: 'Por ejemplo, un descuento sobre lo facturado en un período, hasta la fecha de la nota',
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
      dependsOn: ['tipo-factura'],
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
      skip: isPeriodNote,
    },
    {
      // Las opciones son la moneda de la factura y pesos.
      dependsOn: ['factura'],
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
      skip: (state) => isPeriodNote(state) || !canChooseNoteCurrency(state.invoice),
    },
    {
      dependsOn: ['tipo-factura', 'factura'],
      name: 'fecha-asociado',
      run: async (state, previous) => {
        const invoiceKind = requireStepValue(state.invoiceKind, 'invoiceKind');
        const other = requireStepValue(state.otherSystemInvoice, 'otherSystemInvoice');
        // No posterior a la fecha de la nota (sin fecha, hoy), como `--afecha`.
        const associatedDate = await askTextStep(
          `Fecha ${withPreposition(invoiceKind)} ${formatVoucherNumber(other.pointOfSale, other.number)}:`,
          {
            previousAnswer: previous?.associatedDate,
            validate: noteRule('associatedVoucher.fecha', validateDate, (value) => ({
              associatedDate: completeDateInput(value),
            }))(state),
          },
        );

        return associatedDate === BACK ? BACK : { associatedDate: completeDateInput(associatedDate) };
      },
      // ARCA la pide para controlador fiscal y FactuWeb (10211) y en FCE no se puede tomar de ARCA: siempre.
      skip: (state) => !state.otherSystemInvoice,
      writes: ['associatedVoucher.fecha'],
    },
    {
      name: 'periodo-desde',
      run: async (state, previous) => {
        const periodFrom = await askTextStep('Período desde:', {
          previousAnswer: previous?.periodFrom,
          validate: noteRule('associatedPeriod.desde', validateDate, (value) => ({
            periodFrom: completeDateInput(value),
            periodTo: undefined,
          }))(state),
        });

        return periodFrom === BACK
          ? BACK
          : { invoice: undefined, invoicePointOfSale: undefined, periodFrom: completeDateInput(periodFrom) };
      },
      skip: (state) => !isPeriodNote(state),
      writes: ['associatedPeriod.desde'],
    },
    {
      // No antes del desde ni despues de la fecha de la nota (sin fecha, hoy): 10207 y 10208.
      name: 'periodo-hasta',
      run: async (state, previous) => {
        const periodTo = await askTextStep('Período hasta:', {
          previousAnswer: previous?.periodTo,
          validate: noteRule('associatedPeriod.hasta', validateDate, (value) => ({
            periodTo: completeDateInput(value),
          }))(state),
        });

        return periodTo === BACK ? BACK : { periodTo: completeDateInput(periodTo) };
      },
      skip: (state) => !isPeriodNote(state),
      writes: ['associatedPeriod.hasta'],
    },
    ...receiverSteps<NoteState>({
      dependsOn: ['tipo-factura'],
      letter: (state) => state.invoiceKind?.letter ?? 'c',
      message: () => '¿A quién va la nota?',
      rules,
      skip: (state) => !asksOwnNoteData(state),
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
      skip: (state) => !asksOwnNoteData(state),
    },
    {
      // "Anular el total" muestra el total de la factura.
      dependsOn: ['factura'],
      name: 'alcance',
      run: (state, previous) => askAnnulScope(state, previous?.annulsTotal),
      skip: (state) => !canAnnulTotal(state),
    },
    {
      // El tope de la NC es el total de la factura, en su moneda.
      dependsOn: ['tipo-factura', 'factura', 'moneda'],
      name: 'monto',
      run: (state, previous) => askNoteAmount(state, previous?.totalAmount, rules(state)),
      skip: (state) => state.annulsTotal === true,
      writes: ['totalAmount'],
    },
    // Desde el tope, el documento del consumidor final, si el total en pesos ya se sabe. Como con flags, tambien en
    // una nota sobre una factura a consumidor final (por ejemplo, una de debito mas grande que la factura).
    ...requiredConsumerSteps<NoteState>({ ...consumerOptions, name: 'cf', rules }),
    {
      // Las opciones son las de la letra, y la marcada sale del padron con el CUIT (de la factura o escrito).
      dependsOn: ['tipo-factura', 'factura', 'receptor', 'documento'],
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
      // La deducida de la factura es la que arranca marcada; el texto cambia si la nota es de periodo.
      dependsOn: ['tipo-factura', 'asociacion', 'factura'],
      name: 'alicuota',
      run: async (state, previous) => {
        const ivaRate = await chooseStep(
          asksOwnNoteData(state) ? 'Alícuota de IVA:' : 'Alícuota de IVA del comprobante:',
          ivaRateChoices(),
          // La elegida antes, la deducida de la factura o, como el CLI sin `--alicuota`, la de la config o 21%.
          previous?.ivaRate ?? defaultIvaRate(config, state.ivaRate),
        );

        return ivaRate === BACK ? BACK : { ivaRate };
      },
      // En la C no hay IVA; si la factura deja deducir la alicuota, no se pregunta.
      skip: (state) => state.invoiceKind?.letter === 'c' || (!asksOwnNoteData(state) && Boolean(state.ivaRate)),
    },
    {
      // Es sobre la factura elegida.
      dependsOn: ['factura'],
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
      skip: (state) => !state.invoiceKind?.isElectronicCredit || requiredNoteCancellation(state) !== undefined,
    },
    billingOptionalsStep<NoteState>({
      context: (state) => ({
        concept: state.concept ?? 'servicios',
        consumer: state.documentType === 'consumidor-final' && !isConsumerIdentified(state.advanced),
        defaultIvaRate: defaultIvaRate(config, state.ivaRate),
        hidden: hiddenNoteOptions(state),
        exchangeRateSuggestion,
        rules: rules(state),
        voucherKind: noteKindChoices(state.kind ?? 'credito', requireStepValue(state.invoiceKind, 'invoiceKind')),
      }),
      name: 'avanzadas',
      read: advancedOf,
      write: (advanced) => ({ advanced }),
    }),
    // En una de periodo la moneda se elige en los opcionales: recien ahi se sabe si el total llega al tope.
    ...requiredConsumerSteps<NoteState>({ ...consumerOptions, name: 'cf-final', officialExchangeRate, rules }),
  ];

  // La nota E tiene su propio asistente: despues del selector, ningun paso de A, B y C aplica.
  return withFinalizeNotice(
    steps.map((step, index) =>
      index === 0 ? step : { ...step, skip: (state) => Boolean(state.exported) || Boolean(step.skip?.(state)) },
    ),
  );
}

/** Lo que las reglas de la nota toman de la sesion: el emisor, el punto de venta y hoy (cuando se pregunta). */
function noteRuleEnv(session: InteractiveSession, pointOfSale: number): NoteRuleEnv {
  return { ...noteInputEnv(session, pointOfSale), today: formatDateAsArcaDate(new Date()) };
}

/** El emisor y el punto de venta de la sesion, para la entrada de la nota. */
export function noteInputEnv(session: InteractiveSession, pointOfSale: number): NoteInputEnv {
  return { config: session.runtime.config, issuerCuit: session.runtime.context.cuit, pointOfSale };
}

export async function runNoteFlow(baseSession: InteractiveSession, kind: NoteKind): Promise<void> {
  const ready = await requirePointOfSale(baseSession);

  if (!ready) {
    return;
  }

  const { pointOfSale, session } = ready;
  // La moneda de los opcionales solo se usa en las de periodo; las de una factura van en la de la factura o en pesos.
  const state = await runWizard(
    noteSteps(session, pointOfSale),
    { advanced: initialAdvancedOptions(session.runtime.config), kind },
    undefined,
    {
      // Las reglas sobre la nota final: si una falla, vuelve a la pregunta que escribe el campo.
      finalize: noteFinalize(() => noteRuleEnv(session, pointOfSale)),
    },
  );

  if (!state || state.exported) {
    return;
  }

  await previewAndEmit(session, buildNoteInput(state, noteInputEnv(session, pointOfSale)), noteWarnings(state));
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
