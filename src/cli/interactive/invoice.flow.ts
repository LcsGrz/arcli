import { isIvaConditionAllowed } from '../../modules/billing/billing.iva-receptor';
import { type BillingCommandInput, billingCommandSchema } from '../../modules/billing/billing.schemas';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import type { ArcliConfig } from '../../modules/config/config.schemas';
import { EXPORT_VOUCHER_KIND, type ExportVoucherKind } from '../../modules/export/export.types';
import { parseAmountInput } from '../../modules/interactive/amount-input';
import { conceptChoices, exportInvoiceChoice, invoiceKindChoices } from '../../modules/interactive/choices';
import { defaultIvaRate, explicitIvaRate } from '../../modules/interactive/iva-rate';
import { BACK, type Back, requireStepValue, runWizard, type WizardStep } from '../../modules/interactive/wizard';

import { type AdvancedOptions, askAdvancedOptions, initialAdvancedOptions } from './advanced-options';
import { runExportFlow } from './export.flow';
import { markIfNew } from './new-mark';
import { askTextStep, chooseStep } from './prompts';
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

/** Pasos del flujo de factura; cada uno se puede deshacer con "Volver". */
export function invoiceSteps(session: InteractiveSession): Array<WizardStep<InvoiceState>> {
  const { config } = session.runtime;

  const pickVoucherKind: WizardStep<InvoiceState> = {
    name: 'comprobante',
    run: async (state) => {
      // Volver desde el primer paso de la E vuelve a este selector.
      for (;;) {
        // Con un CUIT del padron no va la E: es para un cliente del exterior.
        const voucherKind = await chooseStep<ExportVoucherKind | VoucherKindDefinition>(
          '¿Qué comprobante querés emitir?',
          state.receiverFromQuery
            ? invoiceKindChoices()
            : [...invoiceKindChoices(), markIfNew(exportInvoiceChoice(), 'factura-e')],
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
      }
    },
    // "Emitir recibo" arranca con el Recibo C elegido.
    skip: (state) => Boolean(state.voucherKind),
  };
  const billingSteps: Array<WizardStep<InvoiceState>> = [
    ...receiverSteps<InvoiceState>({
      letter: (state) => state.voucherKind?.letter ?? 'c',
      message: (state) => (isReceipt(state) ? '¿A quién le hacés el recibo?' : '¿A quién le facturás?'),
      skip: (state) => Boolean(state.receiverFromQuery),
    }),
    {
      name: 'iva-receptor',
      run: async (state) => {
        return askReceiverIvaCondition(session, state, state.voucherKind?.letter ?? 'c', config.ivaReceptorPorDefecto);
      },
      skip: (state) => state.documentType === 'consumidor-final' || ivaConditionFromQueryFits(state),
    },
    {
      name: 'concepto',
      run: async (state) => {
        const concept = await chooseStep(
          isReceipt(state) ? '¿Qué estás cobrando?' : '¿Qué estás facturando?',
          conceptChoices(),
          config.conceptoPorDefecto,
        );

        return concept === BACK ? BACK : { concept };
      },
    },
    {
      name: 'monto',
      run: async () => {
        const answer = await askTextStep('Monto total:', { validate: validateAmount });

        return answer === BACK ? BACK : { totalAmount: parseAmountInput(answer) };
      },
    },
    cbuStep(config),
    {
      name: 'avanzadas',
      run: async (state) => {
        const advanced = await askAdvancedOptions(state.advanced, {
          concept: state.concept ?? 'servicios',
          defaultIvaRate: defaultIvaRate(config),
          voucherKind: requireStepValue(state.voucherKind, 'voucherKind'),
        });

        return advanced === BACK ? BACK : { advanced };
      },
    },
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

  return billingCommandSchema.parse({
    ...state.advanced,
    cbu: isFceInvoice(state) ? (state.cbu ?? config.cbu) : undefined,
    // Como en el CLI: en una FCE el alias de la config se informa junto con el CBU.
    cbuAlias: isFceInvoice(state) ? (state.cbuAlias ?? config.aliasCbu) : undefined,
    concept: state.concept,
    documentNumber: state.documentNumber,
    documentType: state.documentType,
    ivaCondition: state.ivaCondition,
    ...receiverInputFields(state),
    ivaRate: explicitIvaRate(ivaRate, config),
    shortcut: voucherKind.shortcut,
    totalAmount: state.totalAmount,
    transferMode: isFceInvoice(state) ? state.advanced.transferMode : undefined,
  });
}

/** El paso del CBU de "Emitir factura" y "Repetir": solo en facturas FCE, si la config no tiene uno. */
export function cbuStep<S extends InvoiceState>(config: Pick<ArcliConfig, 'aliasCbu' | 'cbu'>): WizardStep<S> {
  return {
    name: 'cbu',
    run: () => askCbuStep(config) as Promise<Back | Partial<S>>,
    skip: (state) => !isFceInvoice(state) || Boolean(config.cbu),
  };
}

/**
 * El CBU de la FCE cuando la config no tiene uno y, si tampoco tiene alias, el alias (Enter lo omite, como sin
 * `--alias`). Lo comparten "Emitir factura" y "Repetir".
 */
export async function askCbuStep(
  config: Pick<ArcliConfig, 'aliasCbu'>,
): Promise<Back | Pick<InvoiceState, 'cbu' | 'cbuAlias'>> {
  const cbu = await askTextStep('CBU del emisor (22 dígitos):', { validate: validateCbu });

  if (cbu === BACK || config.aliasCbu) {
    return cbu === BACK ? BACK : { cbu, cbuAlias: undefined };
  }

  const alias = await askTextStep('Alias del CBU (Enter para omitir):', { validate: validateOptionalCbuAlias });

  return alias === BACK ? BACK : { cbu, cbuAlias: alias.trim() || undefined };
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
 * Sin `voucherKind` pregunta el comprobante; "Emitir recibo" lo pasa ya elegido. Con `receiver` arranca con el CUIT y
 * la condicion IVA del padron. Devuelve BACK si se volvio antes de la vista previa.
 */
export async function runInvoiceFlow(
  baseSession: InteractiveSession,
  voucherKind?: VoucherKindDefinition,
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
    voucherKind,
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
