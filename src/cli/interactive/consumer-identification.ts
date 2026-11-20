import { DEFAULT_CURRENCY_CODE } from '../../modules/billing/billing.constants';
import { requiresConsumerIdentification } from '../../modules/billing/billing.iva-receptor';
import type { BillingCommandInput } from '../../modules/billing/billing.schemas';
import { availableChoice } from '../../modules/interactive/choices';
import {
  amountInPesos,
  type AmountInPesosInput,
  consumerDocumentChoices,
  type ConsumerDocumentType,
  consumerIdentificationNotice,
  isConsumerIdentified,
  reachesConsumerThreshold,
} from '../../modules/interactive/consumer-identification';
import {
  BACK,
  type Back,
  requireStepValue,
  type WizardDependency,
  type WizardStep,
} from '../../modules/interactive/wizard';
import { noticePanel, writeTerminalOutput } from '../../ui';
import { startSpinner } from '../spinner';

import type { AdvancedOptions } from './advanced-options';
import { chooseStep } from './prompts';
import { askDocumentNumber } from './receiver-padron';
import type { InteractiveSession } from './session';
import { normalizeDocumentNumber } from './validators';

/** Con que documento se identifica al consumidor final: DNI, CUIT o CUIL. */
export async function askConsumerDocumentType(previous?: ConsumerDocumentType): Promise<Back | ConsumerDocumentType> {
  const choices = consumerDocumentChoices();

  return chooseStep('Documento del consumidor final:', choices, availableChoice(choices, previous));
}

/** El numero del documento del consumidor final, con la misma validacion que el de un receptor con ese documento. */
export async function askConsumerDocumentNumber(
  documentType: ConsumerDocumentType,
  previous?: number,
): Promise<Back | number> {
  const answer = await askDocumentNumber(documentType, previous, 'del consumidor final');

  return answer === BACK ? BACK : normalizeDocumentNumber(answer);
}

/** Monto, moneda y fecha del comprobante: con la fecha se consulta la cotizacion oficial con `--misma-moneda` (10038). */
type ConsumerAmount = AmountInPesosInput & Pick<Partial<BillingCommandInput>, 'billingDate'>;

interface ConsumerStepState {
  readonly advanced?: AdvancedOptions;
  readonly documentType?: BillingCommandInput['documentType'];
}

interface RequiredConsumerOptions<S> {
  /** Los opcionales del flujo, donde queda el documento (en las notas pueden no estar cargados todavia). */
  readonly advanced: (state: S) => AdvancedOptions;
  readonly amount: (state: S) => ConsumerAmount;
  /** Los pasos que deciden quien es el receptor: si cambia, el documento escrito antes no se ofrece. */
  readonly dependsOn: readonly WizardDependency[];
  /** Prefijo de los dos pasos (`cf` da `cf-documento` y `cf-numero`): unico en el asistente. */
  readonly name: string;
  /**
   * Despues de los opcionales: si la moneda es extranjera y la cotizacion es la oficial de ARCA, la consulta con esta
   * sesion para saber el total en pesos. Sin ella (antes de los opcionales), solo pregunta si el total ya se sabe.
   */
  readonly session?: InteractiveSession;
}

/** El total en pesos con la cotizacion oficial de ARCA. Si la consulta falla, `undefined`: decide la vista previa. */
async function officialAmountInPesos(session: InteractiveSession, amount: ConsumerAmount): Promise<number | undefined> {
  const spinner = startSpinner('Consultando la cotización oficial...');

  try {
    const resolved = await session.service.resolveExchangeRate(
      {
        billingDate: amount.billingDate,
        currencyCode: amount.currencyCode ?? DEFAULT_CURRENCY_CODE,
        exchangeRate: amount.exchangeRate,
        sameCurrency: amount.sameCurrency ?? false,
      },
      session.billingGateway,
    );

    // Con `--misma-moneda` la cotizacion tambien es la oficial: el total en pesos se calcula igual.
    return amountInPesos({ ...amount, exchangeRate: resolved.exchangeRate, sameCurrency: false });
  } catch {
    return undefined;
  } finally {
    spinner?.stop();
  }
}

/**
 * Desde el tope de la RG 5700/2025, el documento del consumidor final (tipo y numero), con el aviso antes. Se usan
 * despues del monto, si el total en pesos ya se sabe, y despues de los opcionales, cuando la moneda o la cotizacion
 * recien se eligieron. Si el consumidor final ya se identifico (en los opcionales o en el par anterior), no preguntan.
 */
export function requiredConsumerSteps<S extends ConsumerStepState>(
  options: RequiredConsumerOptions<S>,
): [WizardStep<S>, WizardStep<S>] {
  const { advanced, amount, session } = options;
  const typeStep = `${options.name}-documento`;
  const pending = (state: S): boolean =>
    state.documentType === 'consumidor-final' && !isConsumerIdentified(advanced(state));

  return [
    {
      dependsOn: options.dependsOn,
      name: typeStep,
      run: async (state, previous) => {
        // Despues de los opcionales, con la cotizacion oficial: recien ahora se sabe si llega al tope.
        if (session && amountInPesos(amount(state)) === undefined) {
          const total = await officialAmountInPesos(session, amount(state));

          if (total === undefined || !requiresConsumerIdentification(total)) {
            return {};
          }
        }

        writeTerminalOutput(noticePanel(consumerIdentificationNotice(), 'info'));

        const documentType = await askConsumerDocumentType(previous?.advanced?.consumerDocumentType);

        return documentType === BACK
          ? BACK
          : ({
              advanced: { ...advanced(state), consumerDocumentNumber: undefined, consumerDocumentType: documentType },
            } as Partial<S>);
      },
      skip: (state) =>
        !pending(state) ||
        !(reachesConsumerThreshold(amount(state)) || (session && amountInPesos(amount(state)) === undefined)),
    },
    {
      // La pregunta y la validacion cambian con el tipo: un DNI escrito antes no se ofrece como CUIT.
      dependsOn: [{ fields: ['advanced.consumerDocumentType'], step: typeStep }],
      name: `${options.name}-numero`,
      run: async (state, previous) => {
        const documentType = requireStepValue(
          advanced(state).consumerDocumentType,
          'el documento del consumidor final',
        );
        const documentNumber = await askConsumerDocumentNumber(
          documentType,
          previous?.advanced?.consumerDocumentNumber,
        );

        return documentNumber === BACK
          ? BACK
          : ({ advanced: { ...advanced(state), consumerDocumentNumber: documentNumber } } as Partial<S>);
      },
      // Solo despues de elegir el tipo en el paso anterior: sin el (no llego al tope) o ya identificado, no aplica.
      skip: (state) =>
        state.documentType !== 'consumidor-final' ||
        advanced(state).consumerDocumentType === undefined ||
        advanced(state).consumerDocumentNumber !== undefined,
    },
  ];
}
