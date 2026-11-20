import { DEFAULT_CURRENCY_CODE } from '../../modules/billing/billing.constants';
import { requiresConsumerIdentification } from '../../modules/billing/billing.iva-receptor';
import { BILLING_RULES } from '../../modules/billing/billing.rules';
import type { BillingCommandInput } from '../../modules/billing/billing.schemas';
import type { AdvancedOptions, BillingRuleScope } from '../../modules/interactive/billing-optionals';
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
import { scopedRuleValidator } from '../../modules/interactive/rule-validator';
import {
  BACK,
  type Back,
  requireStepValue,
  type WizardDependency,
  type WizardStep,
} from '../../modules/interactive/wizard';
import { noticePanel, writeTerminalOutput } from '../../ui';

import type { OfficialExchangeRate } from './official-exchange-rate';
import { chooseStep } from './prompts';
import { askDocumentNumber } from './receiver-padron';
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
  withRules?: (validate: (value: string) => string | true) => (value: string) => string | true,
): Promise<Back | number> {
  const answer = await askDocumentNumber(documentType, previous, 'del consumidor final', withRules);

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
   * Despues de los opcionales: si la moneda es extranjera y la cotizacion es la oficial de ARCA, la consulta con el
   * cargador del flujo para saber el total en pesos. Sin el (antes de los opcionales), solo pregunta si el total ya se
   * sabe.
   */
  readonly officialExchangeRate?: OfficialExchangeRate;
  /** Las reglas del flujo, para el numero: no puede ser el CUIT emisor (10069). */
  readonly rules: (state: S) => BillingRuleScope;
}

/**
 * El total en pesos con la cotizacion oficial de ARCA, la misma que vio la pregunta de la cotizacion (el cargador del
 * flujo). Si la consulta falla, `undefined`: decide la vista previa.
 */
async function officialAmountInPesos(
  official: OfficialExchangeRate,
  amount: ConsumerAmount,
): Promise<number | undefined> {
  const rate = await official({
    billingDate: amount.billingDate,
    currencyCode: amount.currencyCode ?? DEFAULT_CURRENCY_CODE,
    sameCurrency: amount.sameCurrency ?? false,
  });

  // Con `--misma-moneda` la cotizacion tambien es la oficial: el total en pesos se calcula igual.
  return rate === undefined ? undefined : amountInPesos({ ...amount, exchangeRate: rate, sameCurrency: false });
}

/**
 * Desde el tope de la RG 5700/2025, el documento del consumidor final (tipo y numero), con el aviso antes. Se usan
 * despues del monto, si el total en pesos ya se sabe, y despues de los opcionales, cuando la moneda o la cotizacion
 * recien se eligieron. Si el consumidor final ya se identifico (en los opcionales o en el par anterior), no preguntan.
 */
export function requiredConsumerSteps<S extends ConsumerStepState>(
  options: RequiredConsumerOptions<S>,
): [WizardStep<S>, WizardStep<S>] {
  const { advanced, amount, officialExchangeRate } = options;
  const typeStep = `${options.name}-documento`;
  const pending = (state: S): boolean =>
    state.documentType === 'consumidor-final' && !isConsumerIdentified(advanced(state));

  return [
    {
      dependsOn: options.dependsOn,
      name: typeStep,
      run: async (state, previous) => {
        // Despues de los opcionales, con la cotizacion oficial: recien ahora se sabe si llega al tope.
        if (officialExchangeRate && amountInPesos(amount(state)) === undefined) {
          const total = await officialAmountInPesos(officialExchangeRate, amount(state));

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
        !(
          reachesConsumerThreshold(amount(state)) ||
          (officialExchangeRate && amountInPesos(amount(state)) === undefined)
        ),
    },
    {
      // La pregunta y la validacion cambian con el tipo: un DNI escrito antes no se ofrece como CUIT.
      dependsOn: [{ fields: ['advanced.consumerDocumentType'], step: typeStep }],
      name: `${options.name}-numero`,
      // Va como el documento del receptor (`documentNumber`): no puede ser el CUIT emisor (10069).
      writes: ['documentNumber'],
      run: async (state, previous) => {
        const documentType = requireStepValue(
          advanced(state).consumerDocumentType,
          'el documento del consumidor final',
        );
        const documentNumber = await askConsumerDocumentNumber(
          documentType,
          previous?.advanced?.consumerDocumentNumber,
          (validate) =>
            scopedRuleValidator(
              BILLING_RULES,
              'documentNumber',
              options.rules(state),
              (value) => ({ documentNumber: normalizeDocumentNumber(value), documentType }),
              validate,
            ),
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
