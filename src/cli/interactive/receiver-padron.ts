import { isIvaConditionAllowed } from '../../modules/billing/billing.iva-receptor';
import type { BillingCommandInput, BillingIvaCondition } from '../../modules/billing/billing.schemas';
import type { VoucherLetter } from '../../modules/billing/billing.types';
import { isPadronLookupEnabled } from '../../modules/config/config.schemas';
import { availableChoice, ivaConditionChoices } from '../../modules/interactive/choices';
import type { ReceiverFromPadron } from '../../modules/interactive/receiver-document';
import { validateCuil, validateCuit, validateDni } from '../../modules/interactive/validators';
import { BACK, type Back } from '../../modules/interactive/wizard';
import { ArcaPadronGateway } from '../../services/arca/arca-padron.gateway';
import { isPromptCancellation } from '../prompt-cancellation';

import { waitForArca } from './arca-wait';
import { askTextStep, chooseStep } from './prompts';
import type { InteractiveSession } from './session';

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

interface ReceiverState {
  readonly documentNumber?: number;
  readonly documentType?: BillingCommandInput['documentType'];
  readonly receiver?: ReceiverFromPadron;
}

/**
 * Consulta el padron si hay un CUIT y la config lo permite. Si falla, sigue sin datos: el usuario elige igual. Con
 * Ctrl+C no sigue: vuelve al menu.
 */
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

  try {
    const taxpayer = await waitForArca('Consultando el padrón...', () =>
      new ArcaPadronGateway(session.arca).getTaxpayer(cuit),
    );

    return {
      address: taxpayer?.address ?? undefined,
      cuit,
      ivaCondition: taxpayer?.ivaCondition ?? undefined,
      name: taxpayer?.name ?? undefined,
    };
  } catch (error) {
    if (isPromptCancellation(error)) {
      throw error;
    }

    return { cuit };
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
