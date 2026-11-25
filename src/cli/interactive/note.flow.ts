import { formatDateAsArcaDate } from '../../lib/dates/arca-date';
import { creditNoteOverTotalHint, isCreditNoteOverTotal } from '../../modules/billing/billing.associated-lookup';
import { formatMoneyLabel } from '../../modules/billing/billing.labels';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import { discriminatesIva, isNote, isReceipt, noteSide } from '../../modules/billing/voucher-kind-map';
import { formatVoucherLabel, formatVoucherWithArticle } from '../../modules/billing/voucher-names';
import { EXPORT_VOUCHER_KINDS, type ExportVoucherKind } from '../../modules/export/export.types';
import { parseAmountInput } from '../../modules/interactive/amount-input';
import {
  type AssociatedFamily,
  type AssociatedKind,
  associatedKindGroups,
  groupNewOptions,
} from '../../modules/interactive/associated-kinds';
import {
  type AdvancedOptionKey,
  type AdvancedOptions,
  initialAdvancedOptions,
} from '../../modules/interactive/billing-optionals';
import { conceptChoices, ivaRateChoices, noteKindChoices } from '../../modules/interactive/choices';
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
  noteFinalCurrency,
  noteFinalize,
  type NoteInputEnv,
  type NoteKind,
  noteReadAssociated,
  noteReceiverKey,
  type NoteRuleEnv,
  noteRuleScope,
  noteRuleValidator,
  type NoteState,
  requiredNoteCancellation,
} from '../../modules/interactive/note-input';
import { consumerContext } from '../../modules/interactive/steps/consumer';
import { fieldLens } from '../../modules/interactive/steps/lens';
import { validateAmount, validateDate } from '../../modules/interactive/validators';
import { BACK, type Back, requireStepValue, runWizard, type WizardStep } from '../../modules/interactive/wizard';
import type { IssuedVoucher } from '../../modules/vouchers/voucher-history';
import { formatVoucherNumber } from '../../modules/vouchers/voucher-number';
import { noticePanel, writeTerminalOutput } from '../../ui';

import { billingOptionalsGroup, billingOptionalsStep } from './advanced-options';
import { runExportNoteFlow } from './export-note.flow';
import { withFinalizeNotice } from './finalize-notice';
import { pickNoteInvoice } from './invoice-picker';
import { markIfNew } from './new-mark';
import { exchangeRateSuggestionLoader, officialExchangeRateLoader } from './official-exchange-rate';
import { chooseStep } from './prompts';
import { emissionStep, type InteractiveSession, previewAndEmit, requirePointOfSale } from './session';
import { type AmountCurrencyRetry, amountCurrencyRetry, amountStep, billingAmountValidator } from './steps/amount';
import { consumerIdentificationSteps } from './steps/consumer';
import { dateStep } from './steps/date';
import { receiverIvaStep, receiverSteps } from './steps/receiver';

const isOverNote = (state: NoteState): boolean => isNote(state.invoiceKind);

/** Como el CLI y la E: una NC no tiene tope ni se anula entera si ajusta otra NC. */
const isOverCreditNote = (state: NoteState): boolean => noteSide(state.invoiceKind) === 'credito';

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
    // Sobre un comprobante, la moneda es la suya (el receptor tambien: sus datos solo se piden desde el tope).
    ...(asksOwnNoteData(state) ? [] : (['divisas'] as const)),
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

/** "Monto de la nota de crédito" o "de débito"; la pregunta sigue con la moneda si no es pesos. */
const noteAmountLabel = (state: NoteState): string =>
  state.kind === 'debito' ? 'Monto de la nota de débito' : 'Monto de la nota de crédito';

/** El monto de la nota: en una NC sobre una factura en su moneda, no mas que su total (salvo que ajuste otra NC). */
function validateNoteAmount(state: NoteState): (value: string) => string | true {
  const invoice = state.invoice;
  // En pesos sobre un comprobante en otra moneda los totales no se comparan: ni tope.
  const inInvoiceCurrency = state.currency !== 'pesos';

  return (value) => {
    const valid = validateAmount(value);

    if (valid !== true || state.kind !== 'credito' || !invoice || !inInvoiceCurrency || isOverCreditNote(state)) {
      return valid;
    }

    return isCreditNoteOverTotal(parseAmountInput(value) ?? 0, invoice.total)
      ? creditNoteOverTotalHint(describeInvoice(state, invoice), invoice.total, invoice.currency)
      : true;
  };
}

/**
 * Pasos del flujo de notas; cada uno se puede deshacer con "Volver".
 *
 * @internal Exportado para los tests.
 */
export function noteSteps(
  session: InteractiveSession,
  pointOfSale: number,
  retry: AmountCurrencyRetry<NoteState> = noteAmountRetry(session),
): Array<WizardStep<NoteState>> {
  const { config } = session.runtime;
  const officialExchangeRate = officialExchangeRateLoader(session);
  const exchangeRateSuggestion = exchangeRateSuggestionLoader(config, officialExchangeRate);
  const advancedOf = (state: NoteState): AdvancedOptions => state.advanced ?? initialAdvancedOptions(config);
  const ruleEnv = () => noteRuleEnv(session, pointOfSale);
  const rules = (state: NoteState) => noteRuleScope(state, ruleEnv);
  const noteRule = (
    field: string,
    validate: (value: string) => string | true,
    answer: (value: string) => Partial<NoteState>,
  ) => noteRuleValidator(ruleEnv, field, validate, answer);
  const consumerAmount = (state: NoteState) => ({
    ...noteCurrency(state, advancedOf(state)),
    billingDate: advancedOf(state).billingDate,
    totalAmount: state.totalAmount,
  });
  const optionals = billingOptionalsGroup<NoteState>({
    context: (state) => ({
      concept: state.concept ?? 'servicios',
      // Sobre una factura de ARCA el receptor es el suyo: sus datos solo se piden desde el tope. El receptor sale de la
      // factura o se pregunta: si cambia, el documento escrito antes se olvida.
      consumer: consumerContext({
        amount: consumerAmount(state),
        documentType: state.documentType,
        offered: asksOwnNoteData(state),
        receiver: noteReceiverKey(state),
      }),
      defaultIvaRate: defaultIvaRate(config, state.ivaRate),
      hidden: hiddenNoteOptions(state),
      exchangeRateSuggestion,
      rules: rules(state),
      voucherKind: noteKindChoices(state.kind ?? 'credito', requireStepValue(state.invoiceKind, 'invoiceKind')),
    }),
    name: 'avanzadas',
    read: advancedOf,
    write: (advanced) => ({ advanced }),
  });
  const steps: Array<WizardStep<NoteState>> = [
    {
      name: 'tipo-factura',
      run: (state, { previous }) => askAssociatedKind(session, state, previous?.invoiceKind),
    },
    {
      // "A una factura" o "A un recibo", segun el asociado.
      dependsOn: ['tipo-factura'],
      name: 'asociacion',
      run: async (state, { previous }) => {
        const target = await chooseStep(
          '¿A qué la asociamos?',
          [
            {
              description: 'Elegís una de las últimas emitidas o la ingresás a mano',
              name: isReceipt(state.invoiceKind) ? 'A un recibo' : 'A una factura',
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
      run: async (state, { previous }) => {
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
      run: async (state, { previous }) => {
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
    // No posterior a la fecha de la nota (sin fecha, hoy), como `--afecha`. ARCA la pide para controlador fiscal y
    // FactuWeb (10211) y en FCE no se puede tomar de ARCA: siempre.
    dateStep<NoteState>({
      date: fieldLens('associatedDate'),
      dependsOn: ['tipo-factura', 'factura'],
      message: (state) => {
        const other = requireStepValue(state.otherSystemInvoice, 'otherSystemInvoice');

        return `Fecha ${withPreposition(requireStepValue(state.invoiceKind, 'invoiceKind'))} ${formatVoucherNumber(other.pointOfSale, other.number)}:`;
      },
      name: 'fecha-asociado',
      skip: (state) => !state.otherSystemInvoice,
      validate: noteRule(
        'associatedVoucher.fecha',
        (date) => validateDate(date, new Date()),
        (value) => ({
          associatedDate: completeDateInput(value, new Date()),
        }),
      ),
      writes: ['associatedVoucher.fecha'],
    }),
    dateStep<NoteState>({
      date: fieldLens('periodFrom'),
      message: 'Período desde:',
      name: 'periodo-desde',
      skip: (state) => !isPeriodNote(state),
      validate: noteRule(
        'associatedPeriod.desde',
        (date) => validateDate(date, new Date()),
        (value) => ({
          periodFrom: completeDateInput(value, new Date()),
          periodTo: undefined,
        }),
      ),
      write: (periodFrom) => ({ invoice: undefined, invoicePointOfSale: undefined, periodFrom }),
      writes: ['associatedPeriod.desde'],
    }),
    // No antes del desde ni despues de la fecha de la nota (sin fecha, hoy): 10207 y 10208.
    dateStep<NoteState>({
      date: fieldLens('periodTo'),
      message: 'Período hasta:',
      name: 'periodo-hasta',
      skip: (state) => !isPeriodNote(state),
      validate: noteRule(
        'associatedPeriod.hasta',
        (date) => validateDate(date, new Date()),
        (value) => ({ periodTo: completeDateInput(value, new Date()) }),
      ),
      writes: ['associatedPeriod.hasta'],
    }),
    ...receiverSteps<NoteState>({
      dependsOn: ['tipo-factura'],
      letter: (state) => state.invoiceKind?.letter ?? 'c',
      message: () => '¿A quién va la nota?',
      rules,
      skip: (state) => !asksOwnNoteData(state),
    }),
    {
      name: 'concepto',
      run: async (_state, { previous }) => {
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
      run: (state, { previous }) => askAnnulScope(state, previous?.annulsTotal),
      skip: (state) => !canAnnulTotal(state),
    },
    // El tope de la NC es el total de la factura, en su moneda.
    amountStep<NoteState>({
      amount: fieldLens('totalAmount'),
      dependsOn: ['tipo-factura', 'factura', 'moneda'],
      // La de la factura (o pesos) o, en una de periodo, la de los opcionales, que la pueden cambiar despues.
      currency: (state) => noteCurrency(state, advancedOf(state)).currencyCode,
      label: noteAmountLabel,
      retry,
      skip: (state) => state.annulsTotal === true,
      validate: (state) => billingAmountValidator(rules(state), validateNoteAmount(state)),
      write: (totalAmount) => ({ annulsTotal: false, totalAmount }),
      writes: ['totalAmount'],
    }),
    // Desde el tope, el documento del consumidor final, si el total en pesos ya se sabe. Como con flags, tambien en
    // una nota sobre una factura a consumidor final (por ejemplo, una de debito mas grande que la factura).
    ...consumerIdentificationSteps(optionals, { amount: consumerAmount, name: 'cf' }),
    // Las opciones son las de la letra, y la marcada sale del padron con el CUIT (de la factura o escrito). ARCA no
    // devuelve la condicion IVA de la factura, asi que se pregunta.
    receiverIvaStep<NoteState>({
      dependsOn: ['tipo-factura', 'factura', 'receptor', 'documento'],
      letter: (state) => state.invoiceKind?.letter ?? 'c',
      session,
    }),
    {
      // La deducida de la factura es la que arranca marcada; el texto cambia si la nota es de periodo.
      dependsOn: ['tipo-factura', 'asociacion', 'factura'],
      name: 'alicuota',
      run: async (state, { previous }) => {
        const ivaRate = await chooseStep(
          asksOwnNoteData(state) ? 'Alícuota de IVA:' : 'Alícuota de IVA del comprobante:',
          ivaRateChoices(),
          // La elegida antes, la deducida de la factura o, como el CLI sin `--alicuota`, la de la config o 21%.
          previous?.ivaRate ?? defaultIvaRate(config, state.ivaRate),
        );

        return ivaRate === BACK ? BACK : { ivaRate };
      },
      // En la C no hay IVA; si la factura deja deducir la alicuota, no se pregunta.
      skip: (state) =>
        Boolean(state.invoiceKind && !discriminatesIva(state.invoiceKind.letter)) ||
        (!asksOwnNoteData(state) && Boolean(state.ivaRate)),
    },
    {
      // Es sobre la factura elegida.
      dependsOn: ['factura'],
      name: 'anulacion',
      run: async (_state, { previous }) => {
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
    billingOptionalsStep(optionals),
    // En una de periodo la moneda se elige en los opcionales: recien ahi se sabe si el total llega al tope.
    ...consumerIdentificationSteps(optionals, {
      amount: consumerAmount,
      name: 'cf-final',
      official: officialExchangeRate,
    }),
  ];

  // La nota E tiene su propio asistente: despues del selector, ningun paso de A, B y C aplica.
  return withFinalizeNotice(
    steps.map((step, index) =>
      index === 0 ? step : { ...step, skip: (state) => Boolean(state.exported) || Boolean(step.skip?.(state)) },
    ),
  );
}

/** La moneda nueva del monto si los opcionales la cambiaron (en una nota por periodo). */
function noteAmountRetry(session: InteractiveSession): AmountCurrencyRetry<NoteState> {
  return amountCurrencyRetry<NoteState>((state) => noteFinalCurrency(state, session.runtime));
}

/** Lo que las reglas de la nota toman de la sesion: el emisor, el punto de venta y hoy (cuando se pregunta). */
function noteRuleEnv(session: InteractiveSession, pointOfSale: number): NoteRuleEnv {
  return { ...noteInputEnv(session, pointOfSale), today: formatDateAsArcaDate(new Date()) };
}

/**
 * El emisor y el punto de venta de la sesion, para la entrada de la nota.
 *
 * @internal Exportado para los tests.
 */
export function noteInputEnv(session: InteractiveSession, pointOfSale: number): NoteInputEnv {
  return { config: session.runtime.config, issuerCuit: session.runtime.cuit, pointOfSale };
}

export async function runNoteFlow(baseSession: InteractiveSession, kind: NoteKind): Promise<void> {
  const ready = await requirePointOfSale(baseSession);

  if (!ready) {
    return;
  }

  const { pointOfSale, session } = ready;
  // La moneda de los opcionales solo se usa en las de periodo; las de una factura van en la de la factura o en pesos.
  const retry = noteAmountRetry(session);

  await runWizard(
    noteSteps(session, pointOfSale, retry),
    { advanced: initialAdvancedOptions(session.runtime.config), kind },
    undefined,
    {
      // Esc en "¿Emitimos?" vuelve a la ultima pregunta (TUI-15). La nota E ya paso por su propia vista previa.
      confirm: emissionStep<NoteState>((state) =>
        state.exported
          ? undefined
          : previewAndEmit(
              session,
              buildNoteInput(state, noteInputEnv(session, pointOfSale)),
              noteReadAssociated(state, noteInputEnv(session, pointOfSale)),
            ),
      ).confirm,
      // Las reglas sobre la nota final: si una falla, vuelve a la pregunta que escribe el campo.
      finalize: retry.finalize(noteFinalize(() => noteRuleEnv(session, pointOfSale))),
    },
  );
}

/** `de la factura C`, `del recibo C`: para "Fecha de…". */
function withPreposition(invoiceKind: VoucherKindDefinition): string {
  const named = formatVoucherWithArticle(invoiceKind);

  return named.startsWith('el ') ? `del ${named.slice(3)}` : `de ${named}`;
}
