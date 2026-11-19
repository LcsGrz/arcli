import { CONSUMER_DOCUMENT_NUMBER } from '../billing/arca-codes';
import type { BillingCommandInput } from '../billing/billing.schemas';

export { CONSUMER_DOCUMENT_NUMBER };

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
