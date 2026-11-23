import { CONSUMER_DOCUMENT_NUMBER } from '../billing/arca-codes';
import type { BillingCommandInput, BillingIvaCondition } from '../billing/billing.schemas';

/**
 * El numero de documento que el asistente pasa a la entrada del CLI. A consumidor final no se pregunta, pero va 0
 * como con `--cf`: sin numero, la solicitud a ARCA saldria sin `DocNro` y la vista previa no diria "Consumidor final"
 * (REV-61). En los demas tipos, el numero que se cargo.
 */
export function receiverDocumentNumber(receiver: {
  readonly documentNumber?: number;
  readonly documentType?: BillingCommandInput['documentType'];
}): number | undefined {
  return receiver.documentType === 'consumidor-final' ? CONSUMER_DOCUMENT_NUMBER : receiver.documentNumber;
}

/** Lo que el padron dijo del CUIT del receptor, para no volver a consultarlo si el usuario vuelve atras. */
export interface ReceiverFromPadron {
  readonly address?: string;
  readonly cuit: number;
  readonly ivaCondition?: BillingIvaCondition;
  readonly name?: string;
}

/** Nombre, domicilio y origen del IVA para la entrada del CLI: el PDF y la vista previa los muestran. */
export function receiverInputFields(state: {
  readonly documentNumber?: number;
  readonly documentType?: BillingCommandInput['documentType'];
  readonly ivaCondition?: BillingIvaCondition;
  readonly receiver?: ReceiverFromPadron;
}): Pick<BillingCommandInput, 'ivaConditionSource' | 'receiverAddress' | 'receiverName'> {
  const receiver =
    state.documentType === 'cuit' && state.receiver?.cuit === state.documentNumber ? state.receiver : undefined;

  return {
    ivaConditionSource: receiver?.ivaCondition && receiver.ivaCondition === state.ivaCondition ? 'padron' : undefined,
    receiverAddress: receiver?.address,
    receiverName: receiver?.name,
  };
}
