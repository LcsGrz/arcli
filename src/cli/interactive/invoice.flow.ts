import { isIvaConditionAllowed } from '../../modules/billing/billing.iva-receptor';
import { type BillingCommandInput, billingCommandSchema } from '../../modules/billing/billing.schemas';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import type { ArcliConfig } from '../../modules/config/config.schemas';
import { EXPORT_VOUCHER_KIND, type ExportVoucherKind } from '../../modules/export/export.types';
import { amountInputText, parseAmountInput } from '../../modules/interactive/amount-input';
import {
  conceptChoices,
  exportInvoiceChoice,
  invoiceKindChoices,
  reciboChoices,
} from '../../modules/interactive/choices';
import { isConsumerIdentified, resolveReceiverIdentity } from '../../modules/interactive/consumer-identification';
import { defaultIvaRate, explicitIvaRate } from '../../modules/interactive/iva-rate';
import { BACK, type Back, requireStepValue, runWizard, type WizardStep } from '../../modules/interactive/wizard';

import { type AdvancedOptions, askAdvancedOptions, initialAdvancedOptions } from './advanced-options';
import { requiredConsumerSteps } from './consumer-identification';
import { runExportFlow } from './export.flow';
import { markIfNew } from './new-mark';
import { askTextStep, type Choice, chooseStep } from './prompts';
import {
  askReceiverIvaCondition,
  type ReceiverFromPadron,
  receiverInputFields,
  receiverSteps,
} from './receiver-padron';
import { offerSavingToConfig } from './save-to-config';
import { type InteractiveSession, previewAndEmit, requirePointOfSale } from './session';
import { validateAmount, validateCbu, validateOptionalCbuAlias } from './validators';

export interface InvoiceState {
  readonly advanced: AdvancedOptions;
  readonly cbu?: string;
  /** Alias del CBU escrito a mano junto con el CBU; sin el, va el de la config. */
  readonly cbuAlias?: string;
  readonly concept?: BillingCommandInput['concept'];
  readonly documentNumber?: number;
  readonly documentType?: BillingCommandInput['documentType'];
  /** Se eligio la factura E: su asistente ya corrio y el resto de los pasos no aplica. */
  readonly exported?: boolean;
  readonly ivaCondition?: BillingCommandInput['ivaCondition'];
  /** "Emitir recibo": el selector muestra los recibos A, B y C en lugar de las facturas. */
  readonly receipt?: boolean;
  readonly receiver?: ReceiverFromPadron;
  /**
   * El receptor llego cargado desde "Datos de un CUIT": no se pregunta a quien se factura, y la condicion IVA del
   * padron solo se pregunta si no sirve para la letra elegida.
   */
  readonly receiverFromQuery?: boolean;
  readonly totalAmount?: number;
  readonly voucherKind?: VoucherKindDefinition;
}

const isFceInvoice = (state: InvoiceState): boolean => state.voucherKind?.family === 'factura-credito-electronica';
const isReceipt = (state: InvoiceState): boolean => state.voucherKind?.family === 'recibo';
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

/** Consumidor final sin identificar: los opcionales ofrecen cargar su documento. */
export const offersConsumerData = (state: Pick<InvoiceState, 'advanced' | 'documentType'>): boolean =>
  state.documentType === 'consumidor-final' && !isConsumerIdentified(state.advanced);

/** El total y la moneda que deciden si hay que identificar al consumidor final: en "Emitir factura" y "Repetir". */
export const invoiceConsumerAmount = (state: InvoiceState) => ({
  billingDate: state.advanced.billingDate,
  currencyCode: state.advanced.currencyCode,
  exchangeRate: state.advanced.exchangeRate,
  sameCurrency: state.advanced.sameCurrency,
  totalAmount: state.totalAmount,
});

/** Pasos del flujo de factura; cada uno se puede deshacer con "Volver". */
export function invoiceSteps(session: InteractiveSession): Array<WizardStep<InvoiceState>> {
  const { config } = session.runtime;
  // El documento depende de quien es el receptor: si cambia, el escrito antes no se ofrece.
  const consumerOptions = {
    advanced: (state: InvoiceState) => state.advanced,
    amount: invoiceConsumerAmount,
    dependsOn: ['receptor'],
  };

  const pickVoucherKind: WizardStep<InvoiceState> = {
    name: 'comprobante',
    run: async (state, previous) => {
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
      message: (state) => (isReceipt(state) ? '¿A quién le hacés el recibo?' : '¿A quién le facturás?'),
      skip: (state) => Boolean(state.receiverFromQuery),
    }),
    {
      // Las opciones son las de la letra, y la marcada sale del padron con el CUIT.
      dependsOn: ['comprobante', 'receptor', 'documento'],
      name: 'iva-receptor',
      run: async (state, previous) => {
        return askReceiverIvaCondition(
          session,
          state,
          state.voucherKind?.letter ?? 'c',
          config.ivaReceptorPorDefecto,
          previous?.ivaCondition,
        );
      },
      skip: (state) => state.documentType === 'consumidor-final' || ivaConditionFromQueryFits(state),
    },
    {
      name: 'concepto',
      run: async (state, previous) => {
        const concept = await chooseStep(
          isReceipt(state) ? '¿Qué estás cobrando?' : '¿Qué estás facturando?',
          conceptChoices(),
          previous?.concept ?? config.conceptoPorDefecto,
        );

        return concept === BACK ? BACK : { concept };
      },
    },
    {
      name: 'monto',
      run: async (_state, previous) => {
        const answer = await askTextStep('Monto total:', {
          previousAnswer: amountInputText(previous?.totalAmount),
          validate: validateAmount,
        });

        return answer === BACK ? BACK : { totalAmount: parseAmountInput(answer) };
      },
    },
    // Desde el tope, el documento del consumidor final, si el total en pesos ya se sabe (pesos o cotizacion cargada).
    ...requiredConsumerSteps<InvoiceState>({ ...consumerOptions, name: 'cf' }),
    ...cbuSteps(config),
    {
      name: 'avanzadas',
      run: async (state) => {
        const advanced = await askAdvancedOptions(state.advanced, {
          concept: state.concept ?? 'servicios',
          consumer: offersConsumerData(state),
          defaultIvaRate: defaultIvaRate(config),
          voucherKind: requireStepValue(state.voucherKind, 'voucherKind'),
        });

        return advanced === BACK ? BACK : { advanced };
      },
    },
    // La moneda o la cotizacion se eligieron en los opcionales: recien ahi se sabe si el total llega al tope.
    ...requiredConsumerSteps<InvoiceState>({ ...consumerOptions, name: 'cf-final', session }),
  ];

  return [
    pickVoucherKind,
    ...billingSteps.map((step) => ({
      ...step,
      skip: (state: InvoiceState) => Boolean(state.exported) || Boolean(step.skip?.(state)),
    })),
  ];
}

/** Arma la entrada del CLI con lo que respondio el usuario. */
export function buildInvoiceInput(state: InvoiceState, session: InteractiveSession): BillingCommandInput {
  const { config } = session.runtime;
  const voucherKind = requireStepValue(state.voucherKind, 'voucherKind');
  const ivaRate = voucherKind.letter === 'c' ? undefined : defaultIvaRate(config, state.advanced.ivaRate);
  const { consumerDocumentNumber, consumerDocumentType, ...advanced } = state.advanced;
  const receiver = resolveReceiverIdentity(state, { consumerDocumentNumber, consumerDocumentType });

  return billingCommandSchema.parse({
    ...advanced,
    cbu: isFceInvoice(state) ? (state.cbu ?? config.cbu) : undefined,
    // Como en el CLI: en una FCE el alias de la config se informa junto con el CBU.
    cbuAlias: isFceInvoice(state) ? (state.cbuAlias ?? config.aliasCbu) : undefined,
    concept: state.concept,
    documentNumber: receiver.documentNumber,
    documentType: receiver.documentType,
    ivaCondition: receiver.ivaCondition,
    ...receiverInputFields(state),
    ivaRate: explicitIvaRate(ivaRate, config),
    shortcut: voucherKind.shortcut,
    totalAmount: state.totalAmount,
    transferMode: isFceInvoice(state) ? state.advanced.transferMode : undefined,
  });
}

/**
 * El CBU de la FCE cuando la config no tiene uno y, si tampoco tiene alias, el alias (Enter lo omite, como sin
 * `--alias`), en dos pasos. Los comparten "Emitir factura" y "Repetir".
 */
export function cbuSteps<S extends InvoiceState>(config: Pick<ArcliConfig, 'aliasCbu' | 'cbu'>): Array<WizardStep<S>> {
  const asksCbu = (state: S): boolean => isFceInvoice(state) && !config.cbu;

  return [
    {
      name: 'cbu',
      run: async (_state, previous) => {
        const cbu = await askTextStep('CBU del emisor (22 dígitos):', {
          previousAnswer: previous?.cbu,
          validate: validateCbu,
        });

        return cbu === BACK ? BACK : ({ cbu, cbuAlias: undefined } as Partial<S>);
      },
      skip: (state) => !asksCbu(state),
    },
    {
      name: 'alias-cbu',
      run: async (_state, previous) => {
        const alias = await askTextStep('Alias del CBU (Enter para omitir):', {
          previousAnswer: previous?.cbuAlias,
          validate: validateOptionalCbuAlias,
        });

        return alias === BACK ? BACK : ({ cbuAlias: alias.trim() || undefined } as Partial<S>);
      },
      skip: (state) => !asksCbu(state) || Boolean(config.aliasCbu),
    },
  ];
}

/**
 * Si el CBU de la FCE se escribio a mano (no habia en la config), ofrece guardarlo, con el alias si se escribio, como
 * la actividad de la E.
 */
export async function offerSavingCbu(session: InteractiveSession, state: InvoiceState): Promise<void> {
  const { cbu, cbuAlias } = state;

  if (!cbu || session.runtime.config.cbu || !isFceInvoice(state)) {
    return;
  }

  await offerSavingToConfig(
    cbuAlias
      ? `¿Guardamos el CBU y el alias ${cbuAlias} en la config para la próxima?`
      : '¿Guardamos el CBU en la config para la próxima?',
    [['cbu', cbu], ...(cbuAlias ? [['aliasCbu', cbuAlias] as const] : [])],
  );
}

/** El receptor ya cargado, con el CUIT y lo que dijo el padron: "Emitir una factura a este CUIT". */
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
  const state = await runWizard(invoiceSteps(session), {
    advanced: initialAdvancedOptions(session.runtime.config),
    receipt,
    ...(receiver ? invoiceStateForReceiver(receiver) : {}),
  });

  if (!state) {
    return BACK;
  }

  if (state.exported) {
    return undefined;
  }

  await previewAndEmit(session, buildInvoiceInput(state, session));
  await offerSavingCbu(session, state);

  return undefined;
}
