import { BILLING_RULES } from '../../../modules/billing/billing.rules';
import type { BillingCommandInput } from '../../../modules/billing/billing.schemas';
import type { VoucherLetter } from '../../../modules/billing/billing.types';
import type { BillingRuleScope } from '../../../modules/interactive/billing-optionals';
import { availableChoice, receiverChoices } from '../../../modules/interactive/choices';
import type { ReceiverFromPadron } from '../../../modules/interactive/receiver-document';
import { scopedRuleValidator } from '../../../modules/interactive/rule-validator';
import { BACK, type WizardDependency, type WizardStep } from '../../../modules/interactive/wizard';
import { chooseStep } from '../prompts';
import { askDocumentNumber, askReceiverIvaCondition } from '../receiver-padron';
import type { InteractiveSession } from '../session';
import { normalizeDocumentNumber } from '../validators';

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
  readonly rules: (state: S) => BillingRuleScope;
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
            options.rules(state),
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

interface ReceiverIvaState extends ReceiverStepState {
  readonly receiver?: ReceiverFromPadron;
}

/**
 * La condicion frente al IVA del receptor, filtrada por la letra; con un CUIT propone la del padron. ARCA no la
 * devuelve de una factura emitida, asi que tambien se pregunta al repetirla o al hacerle una nota. Con consumidor final
 * no se pregunta. La comparten "Emitir factura", "Repetir" y las notas.
 */
export function receiverIvaStep<S extends ReceiverIvaState>(options: {
  readonly session: InteractiveSession;
  readonly letter: (state: S) => VoucherLetter;
  /** Los pasos de donde salen la letra y el receptor: si cambian, la condicion elegida antes no se ofrece. */
  readonly dependsOn: readonly WizardDependency[];
  /** Ademas de consumidor final, cuando no se pregunta (por ejemplo, la del padron ya sirve para la letra). */
  readonly skip?: (state: S) => boolean;
}): WizardStep<S> {
  const { config } = options.session.runtime;

  return {
    dependsOn: options.dependsOn,
    name: 'iva-receptor',
    run: async (state, previous) =>
      (await askReceiverIvaCondition(
        options.session,
        state,
        options.letter(state),
        config.ivaReceptorPorDefecto,
        previous?.ivaCondition,
      )) as Partial<S> | typeof BACK,
    skip: (state) => state.documentType === 'consumidor-final' || Boolean(options.skip?.(state)),
  };
}
