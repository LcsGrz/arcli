import { BILLING_RULES } from '../../../modules/billing/billing.rules';
import {
  advancedInputFields,
  type AdvancedOptionKey,
  type AdvancedOptions,
  type BillingOptionalsContext,
} from '../../../modules/interactive/billing-optionals';
import { availableChoice } from '../../../modules/interactive/choices';
import {
  consumerDocumentChoices,
  type ConsumerDocumentType,
  isConsumerIdentified,
} from '../../../modules/interactive/consumer-identification';
import { type OptionalGroupDef, requiredOptional } from '../../../modules/interactive/optional-group';
import { scopedRuleValidator } from '../../../modules/interactive/rule-validator';
import {
  type ConsumerAmount,
  needsOfficialRate,
  officialRateQuery,
  withOfficialRequirement,
} from '../../../modules/interactive/steps/consumer';
import { BACK, type Back, type WizardStep } from '../../../modules/interactive/wizard';
import { noticePanel, writeTerminalOutput } from '../../../ui';
import type { OfficialExchangeRate } from '../official-exchange-rate';
import { chooseStep } from '../prompts';
import { askDocumentNumber } from '../receiver-padron';
import { normalizeDocumentNumber } from '../validators';

/** Con que documento se identifica al consumidor final: DNI, CUIT o CUIL. */
async function askConsumerDocumentType(previous?: ConsumerDocumentType): Promise<Back | ConsumerDocumentType> {
  const choices = consumerDocumentChoices();

  return chooseStep('Documento del consumidor final:', choices, availableChoice(choices, previous));
}

/**
 * Las preguntas del opcional "Datos del consumidor final": el tipo de documento y el numero, con la misma validacion
 * que el de un receptor con ese documento. El numero va como el documento del receptor (`documentNumber`): no puede
 * ser el CUIT emisor (10069).
 */
export function consumerQuestions(context: BillingOptionalsContext): ReadonlyArray<WizardStep<AdvancedOptions>> {
  return [
    {
      name: 'consumidor-documento',
      run: async (current, { previous }) => {
        const documentType = await askConsumerDocumentType(
          previous?.consumerDocumentType ?? current.consumerDocumentType,
        );

        return documentType === BACK ? BACK : { consumerDocumentNumber: undefined, consumerDocumentType: documentType };
      },
    },
    {
      // La pregunta y la validacion cambian con el tipo.
      dependsOn: ['consumidor-documento'],
      name: 'consumidor-numero',
      writes: ['documentNumber'],
      run: async (current, { previous }) => {
        const documentType = current.consumerDocumentType ?? 'dni';
        const answer = await askDocumentNumber(
          documentType,
          previous?.consumerDocumentNumber,
          'del consumidor final',
          (base) =>
            scopedRuleValidator(
              BILLING_RULES,
              'documentNumber',
              context.rules,
              (value) => ({
                ...advancedInputFields(current),
                documentNumber: normalizeDocumentNumber(value),
                documentType,
              }),
              base,
            ),
        );

        return answer === BACK ? BACK : { consumerDocumentNumber: normalizeDocumentNumber(answer) };
      },
    },
  ];
}

export type BillingOptionalsGroup<S> = OptionalGroupDef<S, AdvancedOptionKey, AdvancedOptions, BillingOptionalsContext>;

export interface ConsumerIdentificationStepsDef<S> {
  /** Prefijo de los pasos (`cf` da `cf:consumidor-documento`): unico en el asistente. */
  readonly name: string;
  /** El total, la moneda y la fecha que deciden si llega al tope. */
  readonly amount: (state: S) => ConsumerAmount;
  /**
   * Despues de los opcionales: si la moneda es extranjera y la cotizacion es la oficial de ARCA, la consulta con el
   * cargador del flujo para saber el total en pesos. Sin el (antes de los opcionales), solo se pide si el total ya se
   * sabe.
   */
  readonly official?: OfficialExchangeRate;
}

/**
 * Desde el tope de la RG 5700/2025, el documento del consumidor final (tipo y numero), con el aviso antes, como el
 * opcional "Datos del consumidor final" obligatorio (`requiredOptional`, REV-66). Se usan despues del monto, si el total
 * en pesos ya se sabe, y despues de los opcionales, cuando la moneda o la cotizacion recien se eligieron. Si el
 * documento ya se cargo (en los opcionales o en el par anterior), no preguntan; si el total baja del tope, lo respondido
 * queda como opcional marcado. Los usan "Emitir factura" y "Emitir recibo", "Repetir" y las notas.
 */
export function consumerIdentificationSteps<S>(
  group: BillingOptionalsGroup<S>,
  def: ConsumerIdentificationStepsDef<S>,
): Array<WizardStep<S>> {
  const { official } = def;
  const known = (state: S) => official?.known(officialRateQuery(def.amount(state)));
  // Con la cotizacion oficial ya consultada, el tope se mira con ella.
  const context = (state: S): BillingOptionalsContext => {
    const base = group.context(state);

    return official && base.consumer
      ? { ...base, consumer: withOfficialRequirement(base.consumer, def.amount(state), known(state)) }
      : base;
  };

  return requiredOptional(group, {
    answered: isConsumerIdentified,
    context,
    key: 'consumidor',
    name: def.name,
    notice: (reason) => writeTerminalOutput(noticePanel(reason, 'info')),
    pending: official && {
      resolve: async (state) => {
        await official(officialRateQuery(def.amount(state)));
      },
      when: (state) => Boolean(group.context(state).consumer) && needsOfficialRate(def.amount(state), known(state)),
    },
    questions: ['consumidor-documento', 'consumidor-numero'],
  });
}
