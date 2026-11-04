import { type BillingCommandInput, billingCommandSchema } from '../../modules/billing/billing.schemas';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import { EXPORT_VOUCHER_KIND, type ExportVoucherKind } from '../../modules/export/export.types';
import { parseAmountInput } from '../../modules/interactive/amount-input';
import {
  conceptChoices,
  exportInvoiceChoice,
  invoiceKindChoices,
  receiverChoices,
} from '../../modules/interactive/choices';
import { BACK, runWizard, type WizardStep } from '../../modules/interactive/wizard';

import { type AdvancedOptions, askAdvancedOptions } from './advanced-options';
import { runExportFlow } from './export.flow';
import { askTextStep, chooseStep } from './prompts';
import { askReceiverIvaCondition, type ReceiverFromPadron, receiverInputFields } from './receiver-padron';
import { type InteractiveSession, previewAndEmit } from './session';
import { normalizeDocumentNumber, validateAmount, validateCbu, validateCuit, validateDni } from './validators';

export interface InvoiceState {
  readonly advanced: AdvancedOptions;
  readonly cbu?: string;
  readonly concept?: BillingCommandInput['concept'];
  readonly documentNumber?: number;
  readonly documentType?: BillingCommandInput['documentType'];
  /** Se eligio la factura E: su asistente ya corrio y el resto de los pasos no aplica. */
  readonly exported?: boolean;
  readonly ivaCondition?: BillingCommandInput['ivaCondition'];
  readonly receiver?: ReceiverFromPadron;
  readonly totalAmount?: number;
  readonly voucherKind?: VoucherKindDefinition;
}

const isFceInvoice = (state: InvoiceState): boolean => state.voucherKind?.family === 'factura-credito-electronica';

/** Pasos del flujo de factura; cada uno se puede deshacer con "Volver". */
export function invoiceSteps(session: InteractiveSession): Array<WizardStep<InvoiceState>> {
  const { config } = session.runtime;

  const pickVoucherKind: WizardStep<InvoiceState> = {
    name: 'comprobante',
    run: async () => {
      // Volver desde el primer paso de la E vuelve a este selector.
      for (;;) {
        const voucherKind = await chooseStep<ExportVoucherKind | VoucherKindDefinition>(
          '¿Qué comprobante querés emitir?',
          [...invoiceKindChoices(), exportInvoiceChoice()],
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
  };
  const billingSteps: Array<WizardStep<InvoiceState>> = [
    {
      name: 'receptor',
      run: async (state) => {
        const documentType = await chooseStep(
          '¿A quien le facturas?',
          receiverChoices(state.voucherKind?.letter ?? 'c'),
        );

        return documentType === BACK
          ? BACK
          : {
              documentNumber: undefined,
              documentType,
              ivaCondition: documentType === 'consumidor-final' ? 'consumidor-final' : undefined,
            };
      },
    },
    {
      name: 'documento',
      run: async (state) => {
        const isCuit = state.documentType === 'cuit';
        const answer = await askTextStep(isCuit ? 'CUIT del receptor:' : 'DNI del receptor:', {
          validate: isCuit ? validateCuit : validateDni,
        });

        return answer === BACK ? BACK : { documentNumber: normalizeDocumentNumber(answer) };
      },
      skip: (state) => state.documentType === 'consumidor-final',
    },
    {
      name: 'iva-receptor',
      run: async (state) => {
        return askReceiverIvaCondition(session, state, state.voucherKind?.letter ?? 'c', config.ivaReceptorPorDefecto);
      },
      skip: (state) => state.documentType === 'consumidor-final',
    },
    {
      name: 'concepto',
      run: async () => {
        const concept = await chooseStep('¿Qué estás facturando?', conceptChoices(), config.conceptoPorDefecto);

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
    {
      name: 'cbu',
      run: async () => {
        const cbu = await askTextStep('CBU del emisor (22 digitos):', { validate: validateCbu });

        return cbu === BACK ? BACK : { cbu };
      },
      skip: (state) => !isFceInvoice(state) || Boolean(config.cbu),
    },
    {
      name: 'avanzadas',
      run: async (state) => {
        const advanced = await askAdvancedOptions(state.advanced, {
          concept: state.concept ?? 'servicios',
          defaultIvaRate: config.alicuotaPorDefecto ?? '21',
          voucherKind: state.voucherKind as VoucherKindDefinition,
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
  const voucherKind = state.voucherKind as VoucherKindDefinition;
  const ivaRate =
    voucherKind.letter === 'c' ? undefined : (state.advanced.ivaRate ?? config.alicuotaPorDefecto ?? '21');

  return billingCommandSchema.parse({
    ...state.advanced,
    cbu: isFceInvoice(state) ? (state.cbu ?? config.cbu) : undefined,
    // Como en el CLI: en una FCE el alias de la config se informa junto con el CBU.
    cbuAlias: isFceInvoice(state) ? config.aliasCbu : undefined,
    concept: state.concept,
    documentNumber: state.documentNumber,
    documentType: state.documentType,
    ivaCondition: state.ivaCondition,
    ...receiverInputFields(state),
    // 21% sin alicuota configurada es el default del CLI. Si hay config, se deja explicito para que el
    // comando equivalente no tome la de la config.
    ivaRate: ivaRate === '21' && !config.alicuotaPorDefecto ? undefined : ivaRate,
    shortcut: voucherKind.shortcut,
    totalAmount: state.totalAmount,
    transferMode: isFceInvoice(state) ? state.advanced.transferMode : undefined,
  });
}

export async function runInvoiceFlow(session: InteractiveSession): Promise<void> {
  const state = await runWizard(invoiceSteps(session), { advanced: { currencyCode: 'ARS', sameCurrency: false } });

  if (!state || state.exported) {
    return;
  }

  await previewAndEmit(session, buildInvoiceInput(state, session));
}
