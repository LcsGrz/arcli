import { isIvaConditionAllowed } from '../../modules/billing/billing.iva-receptor';
import { BILLING_RULES } from '../../modules/billing/billing.rules';
import type { BillingCommandInput, BillingIvaCondition } from '../../modules/billing/billing.schemas';
import type { VoucherLetter } from '../../modules/billing/billing.types';
import { isPadronLookupEnabled } from '../../modules/config/config.schemas';
import type { BillingRuleScope } from '../../modules/interactive/billing-optionals';
import { availableChoice, ivaConditionChoices, receiverChoices } from '../../modules/interactive/choices';
import type { ReceiverFromPadron } from '../../modules/interactive/receiver-document';
import { scopedRuleValidator } from '../../modules/interactive/rule-validator';
import { BACK, type Back, type WizardStep } from '../../modules/interactive/wizard';
import { ArcaPadronGateway } from '../../services/arca/arca-padron.gateway';
import { startSpinner } from '../spinner';

import { askTextStep, chooseStep } from './prompts';
import type { InteractiveSession } from './session';
import { normalizeDocumentNumber, validateCuil, validateCuit, validateDni } from './validators';

const DOCUMENT_PROMPTS = {
  cuil: { label: 'CUIL', validate: validateCuil },
  cuit: { label: 'CUIT', validate: validateCuit },
  dni: { label: 'DNI', validate: validateDni },
} as const;

/**
 * El numero del documento elegido: CUIT, CUIL o DNI, cada uno con su validacion. `owner` completa la pregunta ("DNI
 * del receptor:", "DNI del consumidor final:").
 */
export async function askDocumentNumber(
  documentType: BillingCommandInput['documentType'] | undefined,
  previous?: number,
  owner = 'del receptor',
  withRules: (validate: (value: string) => string | true) => (value: string) => string | true = (validate) => validate,
): Promise<Back | string> {
  const prompt = DOCUMENT_PROMPTS[documentType === 'cuil' || documentType === 'dni' ? documentType : 'cuit'];

  return askTextStep(`${prompt.label} ${owner}:`, {
    previousAnswer: previous === undefined ? undefined : String(previous),
    validate: withRules(prompt.validate),
  });
}

interface ReceiverStepState {
  readonly documentNumber?: number;
  readonly documentType?: BillingCommandInput['documentType'];
  readonly ivaCondition?: BillingCommandInput['ivaCondition'];
}

interface ReceiverStepOptions<S> {
  /** Los pasos de los que salen la letra y si es FCE: si cambian, el tipo de receptor elegido antes no se ofrece. */
  readonly dependsOn?: readonly string[];
  /** Si es una FCE: como la A, solo admite CUIT (10015). */
  readonly electronicCredit?: (state: S) => boolean;
  /** La letra del comprobante: la A solo admite CUIT. */
  readonly letter: (state: S) => VoucherLetter;
  readonly message: (state: S) => string;
  /** Cuando no se pregunta el receptor (ya vino cargado, o la nota va sobre una factura). */
  readonly skip: (state: S) => boolean;
  /** Las reglas del flujo, para el numero: no puede ser el CUIT emisor (10069). */
  readonly rules?: (state: S) => BillingRuleScope;
}

/**
 * A quien va el comprobante (consumidor final, CUIT, DNI o CUIL, segun la letra) y, si no es consumidor final, el
 * numero. Cambiar el tipo descarta el numero anterior. Los comparten "Emitir factura" y las notas por periodo.
 */
export function receiverSteps<S extends ReceiverStepState>(
  options: ReceiverStepOptions<S>,
): [WizardStep<S>, WizardStep<S>] {
  return [
    {
      dependsOn: options.dependsOn,
      name: 'receptor',
      run: async (state, previous) => {
        const choices = receiverChoices(options.letter(state), options.electronicCredit?.(state));
        const documentType = await chooseStep(
          options.message(state),
          choices,
          availableChoice(choices, previous?.documentType),
        );

        return documentType === BACK
          ? BACK
          : ({
              documentNumber: undefined,
              documentType,
              ivaCondition: documentType === 'consumidor-final' ? 'consumidor-final' : undefined,
            } as Partial<S>);
      },
      skip: options.skip,
    },
    {
      // El texto y la validacion cambian con el tipo: un DNI escrito antes no se ofrece como CUIT.
      dependsOn: ['receptor'],
      name: 'documento',
      run: async (state, previous) => {
        const answer = await askDocumentNumber(state.documentType, previous?.documentNumber, undefined, (validate) =>
          scopedRuleValidator(
            BILLING_RULES,
            'documentNumber',
            options.rules?.(state),
            (value) => ({ documentNumber: normalizeDocumentNumber(value), documentType: state.documentType }),
            validate,
          ),
        );

        return answer === BACK ? BACK : ({ documentNumber: normalizeDocumentNumber(answer) } as Partial<S>);
      },
      skip: (state) => state.documentType === 'consumidor-final' || options.skip(state),
      writes: ['documentNumber'],
    },
  ];
}

interface ReceiverState {
  readonly documentNumber?: number;
  readonly documentType?: BillingCommandInput['documentType'];
  readonly receiver?: ReceiverFromPadron;
}

/** Consulta el padron si hay un CUIT y la config lo permite. Si falla, sigue sin datos: el usuario elige igual. */
async function lookupReceiver(
  session: InteractiveSession,
  state: ReceiverState,
): Promise<ReceiverFromPadron | undefined> {
  const cuit = state.documentNumber;

  if (state.documentType !== 'cuit' || !cuit || !isPadronLookupEnabled(session.runtime.config)) {
    return undefined;
  }

  if (state.receiver?.cuit === cuit) {
    return state.receiver;
  }

  const spinner = startSpinner('Consultando el padrón...');

  try {
    const taxpayer = await new ArcaPadronGateway(session.arca).getTaxpayer(cuit);

    return {
      address: taxpayer?.address ?? undefined,
      cuit,
      ivaCondition: taxpayer?.ivaCondition ?? undefined,
      name: taxpayer?.name ?? undefined,
    };
  } catch {
    return { cuit };
  } finally {
    spinner?.stop();
  }
}

/**
 * Pregunta la condicion IVA del receptor. Con un CUIT, propone la del padron (marcada) y muestra el nombre;
 * si no, la de la config. Al volver a la pregunta arranca marcada la elegida antes (`previous`).
 */
export async function askReceiverIvaCondition(
  session: InteractiveSession,
  state: ReceiverState,
  letter: VoucherLetter,
  configDefault?: BillingIvaCondition,
  previous?: BillingIvaCondition,
): Promise<Back | { ivaCondition: BillingIvaCondition; receiver?: ReceiverFromPadron }> {
  const receiver = await lookupReceiver(session, state);
  const fromPadron =
    receiver?.ivaCondition && isIvaConditionAllowed(letter, receiver.ivaCondition) ? receiver.ivaCondition : undefined;
  const choices = ivaConditionChoices(letter).map((choice) =>
    choice.value === fromPadron ? { ...choice, name: `${choice.name} (según el padrón)` } : choice,
  );
  const ivaCondition = await chooseStep(
    receiver?.name ? `Condición frente al IVA de ${receiver.name}:` : 'Condición frente al IVA del receptor:',
    choices,
    // Lo elegido antes puede no servir para la letra: entonces arranca en la del padron o la de la config.
    availableChoice(choices, previous, fromPadron, configDefault),
  );

  return ivaCondition === BACK ? BACK : { ivaCondition, receiver };
}
