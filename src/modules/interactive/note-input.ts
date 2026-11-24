import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import type { AssociatedPointOfSaleOrigin } from '../billing/billing.associated-lookup';
import { resolveRequiredCancellation } from '../billing/billing.associated-vouchers';
import { BILLING_RULES, type BillingRuleContext } from '../billing/billing.rules';
import { type BillingCommandInput, billingCommandSchema, type BillingConcept } from '../billing/billing.schemas';
import type { VoucherKindDefinition } from '../billing/billing.types';
import { parseZodInput } from '../billing/billing.zod-errors';
import type { ArcliConfig } from '../config/config.schemas';
import type { IssuedVoucher } from '../vouchers/voucher-history';

import { type AdvancedOptions, type BillingRuleScope, initialAdvancedOptions } from './billing-optionals';
import { noteKindChoices } from './choices';
import { resolveReceiverIdentity } from './consumer-identification';
import { copyInvoiceAmounts } from './invoice-copy';
import { explicitIvaRate } from './iva-rate';
import { type NoteCurrency, resolveNoteCurrency } from './note-currency';
import { type ReceiverFromPadron, receiverInputFields } from './receiver-document';
import { rulesFinalize, ruleValidator } from './rule-validator';
import { amountCurrencyFinalize } from './steps/amount';
import { requireStepValue, type WizardFinalize } from './wizard';

export type NoteKind = 'credito' | 'debito';

/**
 * Un comprobante ingresado a mano que ARCA no tiene, en un punto de venta que no es de web service (o que no se pudo
 * clasificar): de Comprobantes en linea, de un controlador fiscal o de otro sistema. Igual sirve de asociado de una
 * nota, pero sus datos no se pueden copiar (ver `checkAssociatedInArca`).
 */
export interface OtherSystemInvoice {
  readonly number: number;
  readonly origin: Exclude<AssociatedPointOfSaleOrigin, 'web-service'>;
  readonly otherSystem: true;
  readonly pointOfSale: number;
  /** El motivo, si ARCA contesto con un error en lugar de decir que no existe. */
  readonly queryReason?: string;
}

/** Lo que responde quien emite una nota de credito o debito A, B, C o FCE. */
export interface NoteState {
  /** Fecha, fechas de servicio y vencimiento; en las de periodo, la moneda, y en las parciales, exento y no gravado. */
  readonly advanced?: AdvancedOptions;
  /** La moneda en que se escribio el monto: si los opcionales la cambian, `finalize` vuelve al monto (REV-74, #12). */
  readonly amountCurrency?: string;
  /** La fecha del asociado de otro sistema, que ARCA no tiene (`--afecha`). */
  readonly associatedDate?: string;
  readonly cancellation?: boolean;
  readonly concept?: BillingConcept;
  /** Sobre un comprobante en moneda extranjera: en esa moneda o en pesos (diferencia de cambio). */
  readonly currency?: NoteCurrency;
  readonly documentNumber?: number;
  readonly documentType?: BillingCommandInput['documentType'];
  /** Anula la factura entera: la nota copia exento y no gravado. */
  readonly annulsTotal?: boolean;
  /** Se eligio una factura E: el asistente de la nota E ya corrio y el resto de los pasos no aplica. */
  readonly exported?: boolean;
  readonly invoice?: IssuedVoucher;
  /** El tipo del asociado: una factura, un recibo u otra nota de la misma letra. */
  readonly invoiceKind?: VoucherKindDefinition;
  /** Punto de venta de la factura asociada; ingresada a mano puede no ser el configurado. */
  readonly invoicePointOfSale?: number;
  readonly ivaCondition?: BillingCommandInput['ivaCondition'];
  readonly receiver?: ReceiverFromPadron;
  readonly ivaRate?: BillingCommandInput['ivaRate'];
  /** Credito o debito: viene del menu principal. */
  readonly kind?: NoteKind;
  /**
   * El asociado ingresado a mano que ARCA no tiene, de un punto de venta que no es de web service (Comprobantes en
   * linea, controlador fiscal): no hay de donde copiar sus datos, asi que se preguntan como en una de periodo.
   */
  readonly otherSystemInvoice?: OtherSystemInvoice;
  readonly periodFrom?: string;
  readonly periodTo?: string;
  /** Sobre una factura de la lista o sobre un periodo (solo notas comunes). */
  readonly target?: 'factura' | 'periodo';
  readonly totalAmount?: number;
}

/** Lo que la entrada de la nota toma del emisor y de la config, como el CLI sin el flag. */
export interface NoteInputEnv {
  readonly config: Pick<ArcliConfig, 'alicuotaPorDefecto' | 'cotizacionPorDefecto' | 'monedaPorDefecto'>;
  /** El CUIT emisor: el del asociado, que es del mismo emisor. */
  readonly issuerCuit: number;
  /** El punto de venta del flujo: el del asociado elegido de la lista, si no se ingreso a mano en otro. */
  readonly pointOfSale: number;
}

export const isPeriodNote = (state: Pick<NoteState, 'target'>): boolean => state.target === 'periodo';

/** Sin factura de ARCA de donde copiar receptor, concepto, moneda y alicuota: una de periodo o una de otro sistema. */
export const asksOwnNoteData = (state: Pick<NoteState, 'otherSystemInvoice' | 'target'>): boolean =>
  isPeriodNote(state) || Boolean(state.otherSystemInvoice);

/**
 * En FCE, la anulacion que exige el asociado: una nota sobre otra nota FCE es de anulacion, y una ND FCE sobre la
 * factura no lo es. Solo una NC FCE sobre la factura deja elegir.
 */
export function requiredNoteCancellation(state: Pick<NoteState, 'invoiceKind' | 'kind'>): boolean | undefined {
  const invoiceKind = state.invoiceKind;

  if (!invoiceKind?.isElectronicCredit) {
    return undefined;
  }

  return resolveRequiredCancellation(noteKindChoices(state.kind ?? 'credito', invoiceKind).family, invoiceKind.family);
}

/**
 * La moneda y la cotizacion de la nota. La de periodo o de otro sistema no tiene factura de donde copiarlas: van las
 * elegidas en los opcionales. Sobre un comprobante, las suyas o pesos.
 */
export function noteCurrency(
  state: NoteState,
  advanced: AdvancedOptions,
): Partial<Pick<BillingCommandInput, 'currencyCode' | 'exchangeRate' | 'exchangeRateSource' | 'sameCurrency'>> {
  if (asksOwnNoteData(state)) {
    return {
      currencyCode: advanced.currencyCode,
      exchangeRate: advanced.exchangeRate,
      exchangeRateSource: advanced.exchangeRateSource,
      sameCurrency: advanced.sameCurrency,
    };
  }

  const invoiceKind = state.invoiceKind;
  const copy = state.invoice && invoiceKind ? copyInvoiceAmounts(state.invoice, invoiceKind.letter) : undefined;

  return resolveNoteCurrency(copy, state.currency);
}

/**
 * La entrada del CLI con lo que respondio el usuario: de ella salen el comando equivalente y, con `prepareBillingInput`,
 * la solicitud a ARCA.
 */
export function buildNoteInput(state: NoteState, env: NoteInputEnv): BillingCommandInput {
  return parseZodInput(billingCommandSchema, noteInputFields(state, env));
}

/** Los campos de la entrada de la nota, sin validar: lo que leen las reglas mientras se pregunta. */
function noteInputFields(state: NoteState, env: NoteInputEnv): Partial<BillingCommandInput> {
  const invoiceKind = requireStepValue(state.invoiceKind, 'invoiceKind');
  const noteKind = noteKindChoices(state.kind ?? 'credito', invoiceKind);
  const invoice = state.invoice;
  const period = isPeriodNote(state);
  // Una nota va en la moneda de su factura o en pesos; si la anula entera, tambien copia exento y no gravado.
  const copy = !period && invoice ? copyInvoiceAmounts(invoice, invoiceKind.letter) : undefined;
  const advanced = state.advanced ?? initialAdvancedOptions(env.config);
  const receiver = resolveReceiverIdentity(state, advanced);
  const cuit = String(env.issuerCuit);

  return {
    ...noteCurrency(state, advanced),
    associatedPeriod: period ? { desde: state.periodFrom, hasta: state.periodTo } : undefined,
    associatedVoucher: state.otherSystemInvoice
      ? {
          cuit,
          fecha: state.associatedDate,
          numero: state.otherSystemInvoice.number,
          puntoVenta: state.otherSystemInvoice.pointOfSale,
          shortcut: invoiceKind.shortcut,
        }
      : !period && invoice
        ? {
            cuit,
            fecha: formatArcaDateAsArgentineDate(invoice.date),
            numero: invoice.number,
            puntoVenta: state.invoicePointOfSale ?? env.pointOfSale,
            shortcut: invoiceKind.shortcut,
          }
        : undefined,
    billingDate: advanced.billingDate,
    cancellation: requiredNoteCancellation(state) ?? state.cancellation ?? false,
    concept: state.concept,
    documentNumber: receiver.documentNumber,
    documentType: receiver.documentType,
    exemptAmount: state.annulsTotal ? copy?.exemptAmount : advanced.exemptAmount,
    ivaCondition: receiver.ivaCondition,
    ...receiverInputFields(state),
    ivaRate: explicitIvaRate(state.ivaRate, env.config),
    shortcut: noteKind.shortcut,
    paymentDueDate: advanced.paymentDueDate,
    serviceEndDate: advanced.serviceEndDate,
    serviceStartDate: advanced.serviceStartDate,
    totalAmount: state.totalAmount,
    untaxedAmount: state.annulsTotal ? copy?.untaxedAmount : advanced.untaxedAmount,
  };
}

/** Las reglas desde una pregunta de la nota (`ruleValidator`): la nota que se arma con lo respondido hasta ahi. */
export function noteRuleScope(state: NoteState, env: NoteRuleEnv): BillingRuleScope {
  const invoiceKind = requireStepValue(state.invoiceKind, 'invoiceKind');

  return {
    context: {
      emitterCuit: env.issuerCuit,
      today: env.today,
      voucherKind: noteKindChoices(state.kind ?? 'credito', invoiceKind),
    },
    draft: (patch) => ({ ...noteInputFields(state, env), ...patch }),
  };
}

/** Lo que las reglas de la nota toman del emisor y de la sesion, con hoy (yyyymmdd). */
export type NoteRuleEnv = NoteInputEnv & { readonly today: string };

/**
 * El validador de una pregunta de la nota antes de los opcionales (el periodo, la fecha de un asociado de otro
 * sistema): las reglas que leen `field`, con la nota armada con lo respondido y el candidato (`answer`). La fecha de la
 * nota todavia no se eligio: se compara contra la mas tardia que acepta ARCA (`undecidedBillingDate`). Si `finalize`
 * volvio aca (`retry`), no se eligio fecha de la nota (la pregunta de la fecha ya controla contra esta): va la de hoy,
 * y se compara exacto con ella, asi no se acepta otra vez la misma respuesta (TUI-15).
 */
export function noteRuleValidator(
  env: () => NoteRuleEnv,
  field: string,
  validate: (value: string) => string | true,
  answer: (value: string) => Partial<NoteState>,
): (state: NoteState, retry?: boolean) => (value: string) => string | true {
  return (state, retry = false) =>
    ruleValidator<NoteState, BillingCommandInput, BillingRuleContext>({
      context: (current) => ({
        ...noteRuleScope(current, env()).context,
        undecidedBillingDate: !retry && !current.advanced?.billingDate,
      }),
      draft: (current, value) => noteInputFields({ ...current, ...answer(value) }, env()),
      field,
      rules: BILLING_RULES,
      validate,
    })(state);
}

/** `finalize` de la nota: las reglas sobre la nota final; si una falla, vuelve a la pregunta que escribe el campo. */
export function noteFinalize(env: () => NoteRuleEnv): WizardFinalize<NoteState> {
  const rules = rulesFinalize<NoteState, BillingCommandInput, BillingRuleContext>({
    context: (state) => noteRuleScope(state, env()).context,
    draft: (state) => (state.exported || !state.invoiceKind ? undefined : noteInputFields(state, env())),
    rules: BILLING_RULES,
  });

  return (state) =>
    (state.exported ? undefined : amountCurrencyFinalize(state.amountCurrency, noteFinalCurrency(state, env()))) ??
    rules(state);
}

/** La moneda con que sale la nota: la de la factura (o pesos) o, en una de periodo, la de los opcionales. */
export function noteFinalCurrency(state: NoteState, env: Pick<NoteInputEnv, 'config'>): string | undefined {
  return noteCurrency(state, state.advanced ?? initialAdvancedOptions(env.config)).currencyCode;
}

/**
 * Quien es el receptor de la nota, como una clave: el de la factura de ARCA, o el que se pregunta en una de periodo o
 * sobre una factura de otro sistema (con el punto de venta y el numero escritos). Si cambia, los datos del consumidor
 * final escritos antes se olvidan.
 */
export function noteReceiverKey(
  state: Pick<NoteState, 'documentType' | 'invoice' | 'invoicePointOfSale' | 'otherSystemInvoice' | 'target'>,
): string {
  const other = state.otherSystemInvoice;
  const associated = other
    ? `otro:${other.pointOfSale}:${other.number}`
    : state.invoice
      ? `factura:${state.invoicePointOfSale}:${state.invoice.number}`
      : (state.target ?? '');

  return `${associated}|${state.documentType ?? ''}`;
}
