import { currentMonthPeriod, previousMonthPeriod, type ServicePeriod } from '../../lib/dates/periods';
import { DEFAULT_CURRENCY_CODE } from '../../modules/billing/billing.constants';
import { BILLING_RULES } from '../../modules/billing/billing.rules';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import { EXPORT_VOUCHER_KIND, type ExportVoucherKind } from '../../modules/export/export.types';
import { advancedInputFields } from '../../modules/interactive/billing-optionals';
import { exportInvoiceChoice, invoiceKindChoices, reciboChoices } from '../../modules/interactive/choices';
import {
  asksCopiedExempt,
  copiedReceiverNotice,
  copyInvoiceAmounts,
  copyInvoiceReceiver,
  UNSUPPORTED_DOCUMENT_TYPE_NOTICE,
} from '../../modules/interactive/invoice-copy';
import {
  billingRuleEnv,
  buildInvoiceInput,
  invoiceFinalize,
  invoiceRuleScope,
  type InvoiceState,
} from '../../modules/interactive/invoice-input';
import { defaultIvaRate } from '../../modules/interactive/iva-rate';
import { scopedRuleValidator } from '../../modules/interactive/rule-validator';
import { foreignCurrencyOf, repeatCurrencyLock } from '../../modules/interactive/steps/currency';
import { fieldLens, nestedLens } from '../../modules/interactive/steps/lens';
import { BACK, type Back, requireStepValue, runWizard, type WizardStep } from '../../modules/interactive/wizard';
import type { IssuedVoucher } from '../../modules/vouchers/voucher-history';
import { noticePanel, writeTerminalOutput } from '../../ui';

import { billingOptionalsGroup, billingOptionalsStep } from './advanced-options';
import { runExportRepeatFlow } from './export-repeat.flow';
import { withFinalizeNotice } from './finalize-notice';
import { invoiceAmountRetry, invoiceConsumer, invoiceConsumerAmount } from './invoice.flow';
import { pickInvoice } from './invoice-picker';
import { markIfNew } from './new-mark';
import { exchangeRateSuggestionLoader, officialExchangeRateLoader } from './official-exchange-rate';
import { askTextStep, chooseStep } from './prompts';
import { type InteractiveSession, previewAndEmit, requirePointOfSale } from './session';
import { type AmountCurrencyRetry, amountStep, billingAmountValidator } from './steps/amount';
import { cbuSteps, offerSavingCbu } from './steps/cbu';
import { consumerIdentificationSteps } from './steps/consumer';
import { currencySteps } from './steps/currency';
import { servicePeriodSteps } from './steps/date';
import { receiverIvaStep } from './steps/receiver';
import { sameAmountStep } from './steps/same-amount';
import { normalizeDocumentNumber, validateCuit } from './validators';

type RepeatPeriod = 'actual' | 'anterior' | 'hoy' | 'otro';

export interface RepeatState extends InvoiceState {
  readonly original?: IssuedVoucher;
  /** Punto de venta del original: puede no ser el configurado si se ingreso a mano. */
  readonly originalPointOfSale?: number;
  /** "¿Mismo monto?": si no, se escribe en el paso siguiente. */
  readonly sameAmount?: boolean;
  /** El periodo elegido; con "otro", desde y hasta se escriben en los pasos siguientes. */
  readonly servicePeriod?: RepeatPeriod;
}

const letterOf = (state: RepeatState) => state.voucherKind?.letter ?? 'c';

/** El aviso de un receptor copiado que la letra elegida no admite (una A a un DNI): pide el CUIT. */
function copiedNotice(state: RepeatState): string | undefined {
  const receiver = state.original ? copyInvoiceReceiver(state.original) : undefined;

  return receiver && state.voucherKind ? copiedReceiverNotice(receiver, state.voucherKind) : undefined;
}

function describePeriod(period: ServicePeriod): string {
  return `${period.from} al ${period.to}`;
}

/**
 * Repetir una factura o un recibo: se elige uno de los ultimos emitidos y se copian el comprobante, el receptor, el concepto,
 * el monto y la alicuota. Las fechas se actualizan: la factura sale con fecha de hoy y el periodo se elige. La factura E
 * corre su propio asistente (`runExportRepeatFlow`).
 */
export function repeatSteps(
  session: InteractiveSession,
  pointOfSale: number,
  today: Date = new Date(),
  retry: AmountCurrencyRetry<RepeatState> = invoiceAmountRetry(),
): Array<WizardStep<RepeatState>> {
  const { config } = session.runtime;
  const rules = (state: RepeatState) => invoiceRuleScope(state, billingRuleEnv(session.runtime));
  const officialExchangeRate = officialExchangeRateLoader(session);
  const exchangeRateSuggestion = exchangeRateSuggestionLoader(config, officialExchangeRate);
  const copiedFrom = (state: RepeatState) =>
    `${state.voucherKind?.shortcut}:${state.originalPointOfSale}:${state.original?.number}`;
  // Con "¿Mismo monto? Sí", o con el monto en la moneda del original, la moneda no se cambia (REV-73).
  const currencyLock = (state: RepeatState) => repeatCurrencyLock(state.original, state.sameAmount);
  const optionals = billingOptionalsGroup<RepeatState>({
    context: (state) => ({
      concept: state.concept ?? 'servicios',
      // El receptor sale del comprobante elegido: con otro, el documento del consumidor final escrito antes se olvida.
      consumer: invoiceConsumer(state, copiedFrom(state)),
      // La alicuota y el exento vienen de la factura elegida: con otra, arrancan con lo copiado de esa.
      copiedFrom: copiedFrom(state),
      currencyLock: currencyLock(state),
      defaultIvaRate: defaultIvaRate(config, state.advanced.ivaRate),
      exchangeRateSuggestion,
      // Con otro monto, el exento se vuelve a preguntar: arranca marcado si el original tenia (REV-70).
      exemptFrom: state.sameAmount === true ? 'copiado' : 'preguntado',
      // Sin alicuota deducida de la factura, que la elija en lugar de caer en la de la config.
      preselected: [
        ...(!state.advanced.ivaRate && state.voucherKind?.letter !== 'c' ? ['alicuota' as const] : []),
        ...(asksCopiedExempt(state) ? ['exento' as const] : []),
      ],
      rules: rules(state),
      voucherKind: requireStepValue(state.voucherKind, 'voucherKind'),
    }),
    name: 'opcionales',
    read: (state) => state.advanced,
    write: (advanced) => ({ advanced }),
  });

  const pickVoucherKind: WizardStep<RepeatState> = {
    name: 'tipo',
    run: async (_state, previous) => {
      // Volver desde el primer paso de la E vuelve a este selector, con la E marcada.
      let picked: ExportVoucherKind | VoucherKindDefinition | undefined = previous?.voucherKind;

      for (;;) {
        const voucherKind: Back | ExportVoucherKind | VoucherKindDefinition = await chooseStep<
          ExportVoucherKind | VoucherKindDefinition
        >(
          '¿Qué comprobante querés repetir?',
          [...invoiceKindChoices(), ...reciboChoices(), markIfNew(exportInvoiceChoice(), 'repetir-e')],
          picked,
        );

        if (voucherKind === BACK) {
          return BACK;
        }

        if (voucherKind !== EXPORT_VOUCHER_KIND) {
          return { voucherKind: voucherKind as VoucherKindDefinition };
        }

        if ((await runExportRepeatFlow(session, pointOfSale)) !== BACK) {
          return { exported: true };
        }

        picked = voucherKind;
      }
    },
  };
  const periods = { actual: currentMonthPeriod(today), anterior: previousMonthPeriod(today) } as const;
  const billingSteps: Array<WizardStep<RepeatState>> = [
    {
      dependsOn: ['tipo'],
      name: 'factura',
      run: async (state, previous) => {
        const voucherKind = requireStepValue(state.voucherKind, 'voucherKind');
        const picked = await pickInvoice(session, {
          message: '¿Cuál repetimos?',
          pointOfSale,
          previous:
            previous?.original && previous.originalPointOfSale !== undefined
              ? { number: previous.original.number, pointOfSale: previous.originalPointOfSale }
              : undefined,
          voucherKind,
        });

        if (picked === BACK) {
          return BACK;
        }

        const original = picked.invoice;
        const receiver = copyInvoiceReceiver(original);

        if (!receiver) {
          writeTerminalOutput(noticePanel(UNSUPPORTED_DOCUMENT_TYPE_NOTICE, 'warning'));

          return BACK;
        }

        const copy = copyInvoiceAmounts(original, voucherKind.letter);

        if (copy.limitation) {
          writeTerminalOutput(
            noticePanel(`${copy.limitation} Revisá la alícuota y el monto antes de emitir.`, 'warning'),
          );
        }

        return {
          advanced: {
            // El monto esta en la moneda del original: se repite en esa moneda y despues se pide la cotizacion.
            currencyCode: foreignCurrencyOf(original) ?? DEFAULT_CURRENCY_CODE,
            exchangeRate: undefined,
            exemptAmount: copy.exemptAmount,
            ivaRate: copy.ivaRate,
            sameCurrency: false,
            untaxedAmount: copy.untaxedAmount,
          },
          ...receiver,
          original,
          originalPointOfSale: picked.pointOfSale,
          totalAmount: original.total,
        };
      },
    },
    {
      // Una A (o FCE) vieja a un DNI, CUIL o consumidor final: se pide el CUIT ya, no en el rechazo de la vista previa.
      dependsOn: ['tipo', 'factura'],
      name: 'cuit-receptor',
      run: async (state, previous) => {
        writeTerminalOutput(noticePanel(requireStepValue(copiedNotice(state), 'el aviso del receptor'), 'warning'));

        const cuit = await askTextStep('CUIT del receptor:', {
          previousAnswer: previous?.documentNumber === undefined ? undefined : String(previous.documentNumber),
          // No puede ser el CUIT emisor (10069).
          validate: scopedRuleValidator(
            BILLING_RULES,
            'documentNumber',
            rules(state),
            (value) => ({ documentNumber: normalizeDocumentNumber(value), documentType: 'cuit' as const }),
            validateCuit,
          ),
        });

        return cuit === BACK
          ? BACK
          : { documentNumber: normalizeDocumentNumber(cuit), documentType: 'cuit', ivaCondition: undefined };
      },
      skip: (state) => copiedNotice(state) === undefined,
      writes: ['documentNumber'],
    },
    // ARCA no devuelve la condicion IVA de la factura, asi que se pregunta.
    receiverIvaStep<RepeatState>({ dependsOn: ['tipo', 'factura', 'cuit-receptor'], letter: letterOf, session }),
    sameAmountStep<RepeatState>({
      amount: fieldLens('totalAmount'),
      original: (state) => {
        const original = requireStepValue(state.original, 'original');

        return { currency: original.currency, total: original.total };
      },
      // Si no se puede reproducir (varias alicuotas, tributos), "mismo monto" no daria la misma factura.
      skip: (state) => !state.original || Boolean(copyInvoiceAmounts(state.original, letterOf(state)).limitation),
    }),
    // Va en la moneda de la factura. Con otro monto, el exento y el no gravado del original no se copian: se vuelven a
    // preguntar en los opcionales, con el exento marcado (REV-70).
    amountStep<RepeatState>({
      amount: fieldLens('totalAmount'),
      dependsOn: ['factura'],
      currency: (state) => foreignCurrencyOf(state.original),
      label: 'Monto total',
      // En pesos, los opcionales pueden cambiar la moneda despues: `finalize` vuelve aca si cambio.
      retry,
      skip: (state) => state.sameAmount === true,
      validate: (state) =>
        billingAmountValidator(
          rules({ ...state, advanced: { ...state.advanced, exemptAmount: undefined, untaxedAmount: undefined } }),
        ),
      write: (totalAmount, state) => ({
        advanced: { ...state.advanced, exemptAmount: undefined, untaxedAmount: undefined },
        totalAmount,
      }),
      writes: ['totalAmount'],
    }),
    // La cotizacion del original ya no sirve: se pide la de hoy, en la moneda del original.
    ...currencySteps<RepeatState>({
      currency: {
        get: (state) => state.advanced,
        set: (value, state) => ({ advanced: { ...state.advanced, ...value } }),
      },
      dependsOn: ['factura'],
      lock: currencyLock,
      // En pesos con otro monto la moneda se elige en los opcionales.
      skip: (state) => !foreignCurrencyOf(state.original),
      suggestion: exchangeRateSuggestion,
    }),
    // Con un monto nuevo desde el tope, el documento del consumidor final, si el total en pesos ya se sabe.
    ...consumerIdentificationSteps(optionals, { amount: invoiceConsumerAmount, name: 'cf' }),
    {
      name: 'periodo',
      run: async (state, previous) => {
        const servicePeriod = await chooseStep<RepeatPeriod>(
          'Período del servicio:',
          [
            { description: describePeriod(periods.actual), name: 'Este mes', value: 'actual' },
            { description: describePeriod(periods.anterior), name: 'El mes pasado', value: 'anterior' },
            {
              // Sin fechas de servicio va la fecha del comprobante, que se puede cambiar en los opcionales (#8).
              description: 'La fecha del comprobante: hoy, o la que elijas en los opcionales',
              name: 'Un solo día',
              value: 'hoy',
            },
            { name: 'Otro período', value: 'otro' },
          ],
          previous?.servicePeriod,
        );

        if (servicePeriod === BACK) {
          return BACK;
        }

        const period = servicePeriod === 'actual' || servicePeriod === 'anterior' ? periods[servicePeriod] : undefined;

        // "Otro período" se escribe en los dos pasos siguientes.
        return {
          advanced: { ...state.advanced, serviceEndDate: period?.to, serviceStartDate: period?.from },
          servicePeriod,
        };
      },
      skip: (state) => state.concept === 'productos',
    },
    ...servicePeriodSteps<RepeatState>({
      answered: (state) => advancedInputFields(state.advanced),
      from: nestedLens('advanced', 'serviceStartDate'),
      prefix: 'periodo',
      rules,
      skip: (state) => state.concept === 'productos' || state.servicePeriod !== 'otro',
      to: nestedLens('advanced', 'serviceEndDate'),
    }),
    ...cbuSteps<RepeatState>(config),
    billingOptionalsStep(optionals),
    // Con la cotizacion oficial de ARCA, recien despues de los opcionales se sabe si el total llega al tope.
    ...consumerIdentificationSteps(optionals, {
      amount: invoiceConsumerAmount,
      name: 'cf-final',
      official: officialExchangeRate,
    }),
  ];

  return withFinalizeNotice([
    pickVoucherKind,
    ...billingSteps.map((step) => ({
      ...step,
      skip: (state: RepeatState) => Boolean(state.exported) || Boolean(step.skip?.(state)),
    })),
  ]);
}

export async function runRepeatFlow(baseSession: InteractiveSession): Promise<void> {
  const ready = await requirePointOfSale(baseSession);

  if (!ready) {
    return;
  }

  const { pointOfSale, session } = ready;
  const retry = invoiceAmountRetry<RepeatState>();
  const state = await runWizard(
    repeatSteps(session, pointOfSale, new Date(), retry),
    { advanced: { currencyCode: DEFAULT_CURRENCY_CODE, sameCurrency: false } },
    undefined,
    { finalize: retry.finalize(invoiceFinalize<RepeatState>(() => billingRuleEnv(session.runtime))) },
  );

  if (!state || state.exported) {
    return;
  }

  const authorized = await previewAndEmit(session, buildInvoiceInput(state, session.runtime));

  await offerSavingCbu(session.runtime.config, state, authorized);
}
