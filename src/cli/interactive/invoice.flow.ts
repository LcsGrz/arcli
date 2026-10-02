import { type BillingCommandInput, billingCommandSchema } from '../../modules/billing/billing.schemas';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import { parseAmountInput } from '../../modules/interactive/amount-input';
import {
  conceptChoices,
  invoiceKindChoices,
  ivaConditionChoices,
  ivaRateChoices,
  receiverChoices,
} from '../../modules/interactive/choices';
import { BACK, runWizard, type WizardStep } from '../../modules/interactive/wizard';

import { type AdvancedOptions, askAdvancedOptions } from './advanced-options';
import { askTextStep, chooseStep } from './prompts';
import { type InteractiveSession, previewAndEmit } from './session';
import { normalizeDocumentNumber, validateAmount, validateCbu, validateCuit, validateDni } from './validators';

export interface InvoiceState {
  readonly advanced: AdvancedOptions;
  readonly cbu?: string;
  readonly concept?: BillingCommandInput['concept'];
  readonly documentNumber?: number;
  readonly documentType?: BillingCommandInput['documentType'];
  readonly ivaCondition?: BillingCommandInput['ivaCondition'];
  readonly ivaRate?: BillingCommandInput['ivaRate'];
  readonly totalAmount?: number;
  readonly transferMode?: BillingCommandInput['transferMode'];
  readonly voucherKind?: VoucherKindDefinition;
}

const isFceInvoice = (state: InvoiceState): boolean => state.voucherKind?.family === 'factura-credito-electronica';

/** Pasos del flujo de factura; cada uno se puede deshacer con "Volver". */
export function invoiceSteps(session: InteractiveSession): Array<WizardStep<InvoiceState>> {
  const { config } = session.runtime;

  return [
    {
      name: 'comprobante',
      run: async () => {
        const voucherKind = await chooseStep('¿Que comprobante queres emitir?', invoiceKindChoices());

        return voucherKind === BACK ? BACK : { voucherKind };
      },
    },
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
        const ivaCondition = await chooseStep(
          'Condicion frente al IVA del receptor:',
          ivaConditionChoices(state.voucherKind?.letter ?? 'c'),
          config.ivaReceptorPorDefecto,
        );

        return ivaCondition === BACK ? BACK : { ivaCondition };
      },
      skip: (state) => state.documentType === 'consumidor-final',
    },
    {
      name: 'concepto',
      run: async () => {
        const concept = await chooseStep('¿Que estas facturando?', conceptChoices(), config.conceptoPorDefecto);

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
      name: 'alicuota',
      run: async () => {
        const ivaRate = await chooseStep('Alicuota de IVA:', ivaRateChoices(), config.alicuotaPorDefecto ?? '21');

        return ivaRate === BACK ? BACK : { ivaRate };
      },
      skip: (state) => state.voucherKind?.letter === 'c',
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
      name: 'transferencia',
      run: async () => {
        const transferMode = await chooseStep('Modalidad de transferencia:', [
          { description: 'La opcion habitual', name: 'Sistema de circulacion abierta (SCA)', value: 'sca' as const },
          { name: 'Agente de deposito colectivo (ADC)', value: 'adc' as const },
        ]);

        return transferMode === BACK ? BACK : { transferMode };
      },
      skip: (state) => !isFceInvoice(state),
    },
    {
      name: 'avanzadas',
      run: async (state) => {
        const advanced = await askAdvancedOptions(state.advanced, {
          concept: state.concept ?? 'servicios',
          voucherKind: state.voucherKind as VoucherKindDefinition,
        });

        return advanced === BACK ? BACK : { advanced };
      },
    },
  ];
}

/** Arma la entrada del CLI con lo que respondio el usuario. */
export function buildInvoiceInput(state: InvoiceState, session: InteractiveSession): BillingCommandInput {
  const { config } = session.runtime;
  const voucherKind = state.voucherKind as VoucherKindDefinition;

  return billingCommandSchema.parse({
    ...state.advanced,
    cbu: isFceInvoice(state) ? (state.cbu ?? config.cbu) : undefined,
    concept: state.concept,
    documentNumber: state.documentNumber,
    documentType: state.documentType,
    ivaCondition: state.ivaCondition,
    // 21% sin alicuota configurada es el default del CLI. Si hay config, se deja explicito para que el
    // comando equivalente no tome la de la config.
    ivaRate: state.ivaRate === '21' && !config.alicuotaPorDefecto ? undefined : state.ivaRate,
    shortcut: voucherKind.shortcut,
    totalAmount: state.totalAmount,
    transferMode: isFceInvoice(state) ? state.transferMode : undefined,
  });
}

export async function runInvoiceFlow(session: InteractiveSession): Promise<void> {
  const state = await runWizard(invoiceSteps(session), { advanced: { currencyCode: 'ARS', sameCurrency: false } });

  if (!state) {
    return;
  }

  await previewAndEmit(session, buildInvoiceInput(state, session));
}
