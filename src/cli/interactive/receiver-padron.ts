import { isIvaConditionAllowed } from '../../modules/billing/billing.iva-receptor';
import type { BillingCommandInput, BillingIvaCondition } from '../../modules/billing/billing.schemas';
import type { VoucherLetter } from '../../modules/billing/billing.types';
import { isPadronLookupEnabled } from '../../modules/config/config.schemas';
import { ivaConditionChoices, receiverChoices } from '../../modules/interactive/choices';
import { BACK, type Back, type WizardStep } from '../../modules/interactive/wizard';
import { ArcaPadronGateway } from '../../services/arca/arca-padron.gateway';
import { startSpinner } from '../spinner';

import { askTextStep, chooseStep } from './prompts';
import type { InteractiveSession } from './session';
import { normalizeDocumentNumber, validateCuil, validateCuit, validateDni } from './validators';

const DOCUMENT_PROMPTS = {
  cuil: { message: 'CUIL del receptor:', validate: validateCuil },
  cuit: { message: 'CUIT del receptor:', validate: validateCuit },
  dni: { message: 'DNI del receptor:', validate: validateDni },
} as const;

/** El numero del documento elegido para el receptor: CUIT, CUIL o DNI, cada uno con su validacion. */
export async function askDocumentNumber(
  documentType: BillingCommandInput['documentType'] | undefined,
  previous?: number,
): Promise<Back | string> {
  const prompt = DOCUMENT_PROMPTS[documentType === 'cuil' || documentType === 'dni' ? documentType : 'cuit'];

  return askTextStep(prompt.message, {
    previousAnswer: previous === undefined ? undefined : String(previous),
    validate: prompt.validate,
  });
}

interface ReceiverStepState {
  readonly documentNumber?: number;
  readonly documentType?: BillingCommandInput['documentType'];
  readonly ivaCondition?: BillingCommandInput['ivaCondition'];
}

interface ReceiverStepOptions<S> {
  /** Si es una FCE: como la A, solo admite CUIT (10015). */
  readonly electronicCredit?: (state: S) => boolean;
  /** La letra del comprobante: la A solo admite CUIT. */
  readonly letter: (state: S) => VoucherLetter;
  readonly message: (state: S) => string;
  /** Cuando no se pregunta el receptor (ya vino cargado, o la nota va sobre una factura). */
  readonly skip: (state: S) => boolean;
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
      name: 'receptor',
      run: async (state, previous) => {
        const documentType = await chooseStep(
          options.message(state),
          receiverChoices(options.letter(state), options.electronicCredit?.(state)),
          previous?.documentType,
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
      name: 'documento',
      run: async (state, previous) => {
        const answer = await askDocumentNumber(state.documentType, previous?.documentNumber);

        return answer === BACK ? BACK : ({ documentNumber: normalizeDocumentNumber(answer) } as Partial<S>);
      },
      skip: (state) => state.documentType === 'consumidor-final' || options.skip(state),
    },
  ];
}

/** Lo que el padron dijo del CUIT del receptor, para no volver a consultarlo si el usuario vuelve atras. */
export interface ReceiverFromPadron {
  readonly address?: string;
  readonly cuit: number;
  readonly ivaCondition?: BillingIvaCondition;
  readonly name?: string;
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
    previous ?? fromPadron ?? configDefault,
  );

  return ivaCondition === BACK ? BACK : { ivaCondition, receiver };
}

/** Nombre, domicilio y origen del IVA para la entrada del CLI: el PDF y la vista previa los muestran. */
export function receiverInputFields(
  state: ReceiverState & { readonly ivaCondition?: BillingIvaCondition },
): Pick<BillingCommandInput, 'ivaConditionSource' | 'receiverAddress' | 'receiverName'> {
  const receiver =
    state.documentType === 'cuit' && state.receiver?.cuit === state.documentNumber ? state.receiver : undefined;

  return {
    ivaConditionSource: receiver?.ivaCondition && receiver.ivaCondition === state.ivaCondition ? 'padron' : undefined,
    receiverAddress: receiver?.address,
    receiverName: receiver?.name,
  };
}
