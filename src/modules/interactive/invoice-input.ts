import { type BillingCommandInput, billingCommandSchema } from '../billing/billing.schemas';
import type { VoucherKindDefinition } from '../billing/billing.types';
import type { ArcliConfig } from '../config/config.schemas';

import type { AdvancedOptions } from './billing-optionals';
import { resolveReceiverIdentity } from './consumer-identification';
import { defaultIvaRate, explicitIvaRate } from './iva-rate';
import { type ReceiverFromPadron, receiverInputFields } from './receiver-document';
import { requireStepValue } from './wizard';

/** Lo que responde quien usa "Emitir factura", "Emitir recibo" y "Repetir" (A, B, C y FCE). */
export interface InvoiceState {
  readonly advanced: AdvancedOptions;
  readonly cbu?: string;
  /** Alias del CBU escrito a mano junto con el CBU; sin el, va el de la config. */
  readonly cbuAlias?: string;
  readonly concept?: BillingCommandInput['concept'];
  readonly documentNumber?: number;
  readonly documentType?: BillingCommandInput['documentType'];
  /** Se eligio la factura E: su asistente ya corrio y el resto de los pasos no aplica. */
  readonly exported?: boolean;
  readonly ivaCondition?: BillingCommandInput['ivaCondition'];
  /** "Emitir recibo": el selector muestra los recibos A, B y C en lugar de las facturas. */
  readonly receipt?: boolean;
  readonly receiver?: ReceiverFromPadron;
  /**
   * El receptor llego cargado desde "Datos de un CUIT": no se pregunta a quien se factura, y la condicion IVA del
   * padron solo se pregunta si no sirve para la letra elegida.
   */
  readonly receiverFromQuery?: boolean;
  readonly totalAmount?: number;
  readonly voucherKind?: VoucherKindDefinition;
}

/** Lo que la entrada toma de la config, como el CLI sin el flag: el CBU y su alias en una FCE y la alicuota. */
export interface InvoiceInputEnv {
  readonly config: Pick<ArcliConfig, 'aliasCbu' | 'alicuotaPorDefecto' | 'cbu'>;
}

export const isFceInvoice = (state: Pick<InvoiceState, 'voucherKind'>): boolean =>
  state.voucherKind?.family === 'factura-credito-electronica';

/**
 * La entrada del CLI con lo que respondio el usuario: de ella salen el comando equivalente y, con `prepareBillingInput`,
 * la solicitud a ARCA.
 */
export function buildInvoiceInput(state: InvoiceState, env: InvoiceInputEnv): BillingCommandInput {
  const { config } = env;
  const voucherKind = requireStepValue(state.voucherKind, 'voucherKind');
  const ivaRate = voucherKind.letter === 'c' ? undefined : defaultIvaRate(config, state.advanced.ivaRate);
  const { consumerDocumentNumber, consumerDocumentType, ...advanced } = state.advanced;
  const receiver = resolveReceiverIdentity(state, { consumerDocumentNumber, consumerDocumentType });
  const fce = isFceInvoice(state);

  return billingCommandSchema.parse({
    ...advanced,
    cbu: fce ? (state.cbu ?? config.cbu) : undefined,
    // Como en el CLI: en una FCE el alias de la config se informa junto con el CBU.
    cbuAlias: fce ? (state.cbuAlias ?? config.aliasCbu) : undefined,
    concept: state.concept,
    documentNumber: receiver.documentNumber,
    documentType: receiver.documentType,
    ivaCondition: receiver.ivaCondition,
    ...receiverInputFields(state),
    ivaRate: explicitIvaRate(ivaRate, config),
    shortcut: voucherKind.shortcut,
    totalAmount: state.totalAmount,
    transferMode: fce ? state.advanced.transferMode : undefined,
  });
}
