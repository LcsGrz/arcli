import { formatDateAsArcaDate } from '../../lib/dates/arca-date';
import { BILLING_RULES, type BillingRuleContext } from '../billing/billing.rules';
import { type BillingCommandInput, billingCommandSchema } from '../billing/billing.schemas';
import type { VoucherKindDefinition } from '../billing/billing.types';
import type { ArcliConfig } from '../config/config.schemas';

import type { AdvancedOptions, BillingRuleScope } from './billing-optionals';
import { resolveReceiverIdentity } from './consumer-identification';
import { defaultIvaRate, explicitIvaRate } from './iva-rate';
import { type ReceiverFromPadron, receiverInputFields } from './receiver-document';
import { rulesFinalize } from './rule-validator';
import { requireStepValue, type WizardFinalize } from './wizard';

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
  return billingCommandSchema.parse(invoiceInputFields(state, env));
}

/**
 * Los campos de la entrada, sin validar: lo que leen las reglas (`billing.rules.ts`) mientras se pregunta, con lo que
 * falta como en el CLI sin el flag.
 */
function invoiceInputFields(state: InvoiceState, env: InvoiceInputEnv): Partial<BillingCommandInput> {
  const { config } = env;
  const voucherKind = requireStepValue(state.voucherKind, 'voucherKind');
  const ivaRate = voucherKind.letter === 'c' ? undefined : defaultIvaRate(config, state.advanced.ivaRate);
  const { consumerDocumentNumber, consumerDocumentType, ...advanced } = state.advanced;
  const receiver = resolveReceiverIdentity(state, { consumerDocumentNumber, consumerDocumentType });
  const fce = isFceInvoice(state);

  return {
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
  };
}

/** Lo que las reglas necesitan del emisor ademas de la entrada: su CUIT y hoy (yyyymmdd). */
export interface RuleEnv {
  readonly emitterCuit: number;
  readonly today: string;
}

/** Las reglas desde una pregunta de "Emitir factura", "Emitir recibo" o "Repetir" (`ruleValidator`). */
export function invoiceRuleScope(state: InvoiceState, env: InvoiceInputEnv & RuleEnv): BillingRuleScope {
  return {
    context: {
      emitterCuit: env.emitterCuit,
      today: env.today,
      voucherKind: requireStepValue(state.voucherKind, 'voucherKind'),
    },
    draft: (patch) => ({ ...invoiceInputFields(state, env), ...patch }),
  };
}

/** Lo que las reglas toman de la sesion: la config, el CUIT emisor y hoy (cuando se pregunta). */
export function billingRuleEnv(
  runtime: { readonly config: InvoiceInputEnv['config']; readonly context: { readonly cuit: number } },
  now = new Date(),
): InvoiceInputEnv & RuleEnv {
  return { config: runtime.config, emitterCuit: runtime.context.cuit, today: formatDateAsArcaDate(now) };
}

/**
 * `finalize` de "Emitir factura", "Emitir recibo" y "Repetir": las reglas sobre la entrada final; si una falla, vuelve
 * a la pregunta que escribe el campo. Con la E elegida no hay entrada de A, B y C. `env` se lee al final (hoy).
 */
export function invoiceFinalize<S extends InvoiceState>(env: () => InvoiceInputEnv & RuleEnv): WizardFinalize<S> {
  return rulesFinalize<S, BillingCommandInput, BillingRuleContext>({
    context: (state) => invoiceRuleScope(state, env()).context,
    draft: (state) => (state.exported || !state.voucherKind ? undefined : invoiceInputFields(state, env())),
    rules: BILLING_RULES,
  });
}
