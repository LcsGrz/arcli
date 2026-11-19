import { formatCuit } from '../../lib/identity/format-cuit';
import { formatArgentineMoney } from '../../lib/numbers/argentine-amount';
import { isForeignCurrency } from '../billing/billing.currency';
import { CONSUMER_IDENTIFICATION_THRESHOLD, requiresConsumerIdentification } from '../billing/billing.iva-receptor';
import type { BillingCommandInput, BillingDocumentType } from '../billing/billing.schemas';

import type { InteractiveChoice } from './choices';
import { receiverDocumentNumber } from './receiver-document';

/** Con que documento se identifica a un consumidor final: el CLI lo pide con `--dni`, `--cuit` o `--cuil` y `--ir-cf`. */
export type ConsumerDocumentType = Exclude<BillingDocumentType, 'consumidor-final'>;

/** El documento del consumidor final, si se cargo: en los opcionales o, desde el tope, como paso requerido. */
export interface ConsumerIdentity {
  readonly consumerDocumentNumber?: number;
  readonly consumerDocumentType?: ConsumerDocumentType;
}

/** Monto y moneda del comprobante: con ellos se sabe el total en pesos. */
export type AmountInPesosInput = Pick<
  Partial<BillingCommandInput>,
  'currencyCode' | 'exchangeRate' | 'sameCurrency' | 'totalAmount'
>;

export function consumerDocumentChoices(): Array<InteractiveChoice<ConsumerDocumentType>> {
  return [
    { name: 'DNI', value: 'dni' },
    { name: 'CUIT', value: 'cuit' },
    { name: 'CUIL', value: 'cuil' },
  ];
}

/** El aviso antes de pedir el documento porque el total llega al tope de la RG 5700/2025. */
export function consumerIdentificationNotice(): string {
  return `Desde ${formatArgentineMoney(CONSUMER_IDENTIFICATION_THRESHOLD)}, ARCA pide los datos del consumidor final.`;
}

/**
 * El total en pesos, como lo compara el CLI (total × cotizacion). `undefined` si todavia no se sabe: en moneda
 * extranjera sin cotizacion (la oficial de ARCA, que se consulta despues).
 */
export function amountInPesos(input: AmountInPesosInput): number | undefined {
  if (input.totalAmount === undefined) {
    return undefined;
  }

  if (!input.currencyCode || !isForeignCurrency({ currencyCode: input.currencyCode })) {
    return input.totalAmount;
  }

  return !input.sameCurrency && typeof input.exchangeRate === 'number'
    ? input.totalAmount * input.exchangeRate
    : undefined;
}

/** Si ya se sabe que el total en pesos llega al tope. Sin saberlo (cotizacion oficial), no. */
export function reachesConsumerThreshold(input: AmountInPesosInput): boolean {
  const total = amountInPesos(input);

  return total !== undefined && requiresConsumerIdentification(total);
}

export function isConsumerIdentified(identity: ConsumerIdentity | undefined): boolean {
  return identity?.consumerDocumentType !== undefined && identity.consumerDocumentNumber !== undefined;
}

/** Lo que muestra el opcional: "sin identificar", o el documento cargado (`DNI 30123456`, `CUIT 20-33333333-4`). */
export function describeConsumerIdentity(identity: ConsumerIdentity): string {
  if (!isConsumerIdentified(identity)) {
    return 'sin identificar';
  }

  const number = identity.consumerDocumentNumber ?? 0;

  return identity.consumerDocumentType === 'dni'
    ? `DNI ${number}`
    : `${identity.consumerDocumentType?.toUpperCase()} ${formatCuit(number)}`;
}

interface ReceiverIdentity {
  readonly documentNumber?: number;
  readonly documentType?: BillingDocumentType;
  readonly ivaCondition?: BillingCommandInput['ivaCondition'];
}

/**
 * El receptor que va a la entrada del CLI. Un consumidor final identificado va con su documento y la condicion IVA
 * consumidor final, como `--dni N --ir-cf`; sin identificar, con documento 0 como `--cfinal` (REV-61). Los demas, como
 * se cargaron.
 */
export function resolveReceiverIdentity(receiver: ReceiverIdentity, identity?: ConsumerIdentity): ReceiverIdentity {
  if (receiver.documentType !== 'consumidor-final') {
    return receiver;
  }

  if (identity && isConsumerIdentified(identity)) {
    return {
      documentNumber: identity.consumerDocumentNumber,
      documentType: identity.consumerDocumentType,
      ivaCondition: 'consumidor-final',
    };
  }

  return { ...receiver, documentNumber: receiverDocumentNumber(receiver) };
}
