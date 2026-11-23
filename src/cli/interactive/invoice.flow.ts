import { isIvaConditionAllowed } from '../../modules/billing/billing.iva-receptor';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import { isReceipt } from '../../modules/billing/voucher-kind-map';
import { EXPORT_VOUCHER_KIND, type ExportVoucherKind } from '../../modules/export/export.types';
import { initialAdvancedOptions } from '../../modules/interactive/billing-optionals';
import {
  conceptChoices,
  exportInvoiceChoice,
  invoiceKindChoices,
  reciboChoices,
} from '../../modules/interactive/choices';
import {
  billingRuleEnv,
  buildInvoiceInput,
  invoiceFinalize,
  invoiceRuleScope,
  type InvoiceState,
} from '../../modules/interactive/invoice-input';
import { defaultIvaRate } from '../../modules/interactive/iva-rate';
import type { ReceiverFromPadron } from '../../modules/interactive/receiver-document';
import { type ConsumerAmount, type ConsumerContext, consumerContext } from '../../modules/interactive/steps/consumer';
import { fieldLens } from '../../modules/interactive/steps/lens';
import { BACK, type Back, requireStepValue, runWizard, type WizardStep } from '../../modules/interactive/wizard';

import { billingOptionalsGroup, billingOptionalsStep } from './advanced-options';
import { runExportFlow } from './export.flow';
import { withFinalizeNotice } from './finalize-notice';
import { markIfNew } from './new-mark';
import { exchangeRateSuggestionLoader, officialExchangeRateLoader } from './official-exchange-rate';
import { type Choice, chooseStep } from './prompts';
import { emissionStep, type InteractiveSession, previewAndEmit, requirePointOfSale } from './session';
import { type AmountCurrencyRetry, amountCurrencyRetry, amountStep, billingAmountValidator } from './steps/amount';
import { cbuSteps, offerSavingCbu } from './steps/cbu';
import { consumerIdentificationSteps } from './steps/consumer';
import { receiverIvaStep, receiverSteps } from './steps/receiver';

const ivaConditionFromQueryFits = (state: InvoiceState): boolean =>
  Boolean(
    state.receiverFromQuery &&
    state.ivaCondition &&
    state.voucherKind &&
    isIvaConditionAllowed(state.voucherKind.letter, state.ivaCondition),
  );

/** Los recibos en "Emitir recibo"; si no, las facturas y la E, salvo con un CUIT del padron (es para el exterior). */
function voucherKindChoices(state: InvoiceState): Array<Choice<ExportVoucherKind | VoucherKindDefinition>> {
  if (state.receipt) {
    return reciboChoices().map((choice) => (choice.value.letter === 'c' ? choice : markIfNew(choice, 'recibos-a-b')));
  }

  return state.receiverFromQuery
    ? invoiceKindChoices()
    : [...invoiceKindChoices(), markIfNew(exportInvoiceChoice(), 'factura-e')];
}

/** El total y la moneda que deciden si hay que identificar al consumidor final: en "Emitir factura" y "Repetir". */
export const invoiceConsumerAmount = (state: InvoiceState): ConsumerAmount => ({
  billingDate: state.advanced.billingDate,
  currencyCode: state.advanced.currencyCode,
  exchangeRate: state.advanced.exchangeRate,
  sameCurrency: state.advanced.sameCurrency,
  totalAmount: state.totalAmount,
});

/**
 * Los datos del consumidor final en "Emitir factura" y "Repetir": opcionales por debajo del tope y obligatorios desde
 * ahi. `receiver` es quien es el receptor (en "Repetir", el comprobante elegido): con otro, lo escrito se olvida.
 */
export function invoiceConsumer(state: InvoiceState, receiver: string): ConsumerContext | undefined {
  return consumerContext({
    amount: invoiceConsumerAmount(state),
    documentType: state.documentType,
    offered: true,
    receiver,
  });
}

/** La moneda nueva del monto si los opcionales la cambiaron: la del comprobante con todas las respuestas. */
export const invoiceAmountRetry = <S extends InvoiceState>(): AmountCurrencyRetry<S> =>
  amountCurrencyRetry<S>((state) => state.advanced.currencyCode);

/**
 * Pasos del flujo de factura; cada uno se puede deshacer con "Volver".
 *
 * @internal Exportado para los tests.
 */
export function invoiceSteps(
  session: InteractiveSession,
  retry: AmountCurrencyRetry<InvoiceState> = invoiceAmountRetry(),
): Array<WizardStep<InvoiceState>> {
  const { config } = session.runtime;
  const rules = (state: InvoiceState) => invoiceRuleScope(state, billingRuleEnv(session.runtime));
  const officialExchangeRate = officialExchangeRateLoader(session);
  const exchangeRateSuggestion = exchangeRateSuggestionLoader(config, officialExchangeRate);
  const optionals = billingOptionalsGroup<InvoiceState>({
    context: (state) => ({
      concept: state.concept ?? 'servicios',
      consumer: invoiceConsumer(state, `${state.documentType}`),
      defaultIvaRate: defaultIvaRate(config),
      exchangeRateSuggestion,
      rules: rules(state),
      voucherKind: requireStepValue(state.voucherKind, 'voucherKind'),
    }),
    name: 'avanzadas',
    read: (state) => state.advanced,
    write: (advanced) => ({ advanced }),
  });

  const pickVoucherKind: WizardStep<InvoiceState> = {
    name: 'comprobante',
    run: async (state, { previous }) => {
      // Volver desde el primer paso de la E vuelve a este selector, con la E marcada.
      let picked: ExportVoucherKind | VoucherKindDefinition | undefined = previous?.voucherKind;

      for (;;) {
        const voucherKind: Back | ExportVoucherKind | VoucherKindDefinition = await chooseStep<
          ExportVoucherKind | VoucherKindDefinition
        >(
          state.receipt ? '¿Qué recibo querés emitir?' : '¿Qué comprobante querés emitir?',
          voucherKindChoices(state),
          picked,
        );

        if (voucherKind === BACK) {
          return BACK;
        }

        if (voucherKind !== EXPORT_VOUCHER_KIND) {
          return { voucherKind: voucherKind as VoucherKindDefinition };
        }

        if ((await runExportFlow(session)) !== BACK) {
          return { exported: true };
        }

        picked = voucherKind;
      }
    },
    // Con el comprobante ya elegido no se pregunta.
    skip: (state) => Boolean(state.voucherKind),
  };
  const billingSteps: Array<WizardStep<InvoiceState>> = [
    ...receiverSteps<InvoiceState>({
      dependsOn: ['comprobante'],
      electronicCredit: (state) => Boolean(state.voucherKind?.isElectronicCredit),
      letter: (state) => state.voucherKind?.letter ?? 'c',
      message: (state) => (isReceipt(state.voucherKind) ? '¿A quién le hacés el recibo?' : '¿A quién le facturás?'),
      rules,
      skip: (state) => Boolean(state.receiverFromQuery),
    }),
    // Las opciones son las de la letra, y la marcada sale del padron con el CUIT.
    receiverIvaStep<InvoiceState>({
      dependsOn: ['comprobante', 'receptor', 'documento'],
      letter: (state) => state.voucherKind?.letter ?? 'c',
      session,
      skip: ivaConditionFromQueryFits,
    }),
    {
      name: 'concepto',
      run: async (state, { previous }) => {
        const concept = await chooseStep(
          isReceipt(state.voucherKind) ? '¿Qué estás cobrando?' : '¿Qué estás facturando?',
          conceptChoices(),
          previous?.concept ?? config.conceptoPorDefecto,
        );

        return concept === BACK ? BACK : { concept };
      },
    },
    // En la moneda de la config, si es extranjera, la pregunta la nombra (REV-74, #12).
    amountStep<InvoiceState>({
      amount: fieldLens('totalAmount'),
      currency: (state) => state.advanced.currencyCode,
      label: 'Monto total',
      // Los opcionales pueden cambiar la moneda despues: `finalize` vuelve aca si cambio.
      retry,
      validate: (state) => billingAmountValidator(rules(state)),
      writes: ['totalAmount'],
    }),
    // Desde el tope, el documento del consumidor final, si el total en pesos ya se sabe (pesos o cotizacion cargada).
    ...consumerIdentificationSteps(optionals, { amount: invoiceConsumerAmount, name: 'cf' }),
    ...cbuSteps(config),
    billingOptionalsStep(optionals),
    // La moneda o la cotizacion se eligieron en los opcionales: recien ahi se sabe si el total llega al tope.
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
      skip: (state: InvoiceState) => Boolean(state.exported) || Boolean(step.skip?.(state)),
    })),
  ]);
}

/**
 * El receptor ya cargado, con el CUIT y lo que dijo el padron: "Emitir una factura a este CUIT".
 *
 * @internal Exportado para los tests.
 */
export function invoiceStateForReceiver(receiver: ReceiverFromPadron): Partial<InvoiceState> {
  return {
    documentNumber: receiver.cuit,
    documentType: 'cuit',
    ivaCondition: receiver.ivaCondition,
    receiver,
    receiverFromQuery: true,
  };
}

/**
 * "Emitir factura" pregunta entre las facturas y "Emitir recibo" (`receipt`), entre los recibos. Con `receiver` arranca
 * con el CUIT y la condicion IVA del padron. Devuelve BACK si se volvio antes de la vista previa.
 */
export async function runInvoiceFlow(
  baseSession: InteractiveSession,
  receipt = false,
  receiver?: ReceiverFromPadron,
): Promise<Back | undefined> {
  // Antes del primer paso, tambien para la E: sin punto de venta no tiene sentido completar todo.
  const ready = await requirePointOfSale(baseSession);

  if (!ready) {
    return BACK;
  }

  const { session } = ready;
  const retry = invoiceAmountRetry();
  const emission = emissionStep<InvoiceState>((state) =>
    // La E ya paso por su propia vista previa, adentro del primer paso.
    state.exported ? undefined : previewAndEmit(session, buildInvoiceInput(state, session.runtime)),
  );
  const state = await runWizard(
    invoiceSteps(session, retry),
    {
      advanced: initialAdvancedOptions(session.runtime.config),
      receipt,
      ...(receiver ? invoiceStateForReceiver(receiver) : {}),
    },
    undefined,
    { confirm: emission.confirm, finalize: retry.finalize(invoiceFinalize(() => billingRuleEnv(session.runtime))) },
  );

  if (!state) {
    return BACK;
  }

  if (state.exported) {
    return undefined;
  }

  await offerSavingCbu(session.runtime.config, state, emission.authorized());

  return undefined;
}
