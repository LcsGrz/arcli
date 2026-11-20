import Big from 'big.js';

import { diffArcaDatesInDays, formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { formatArgentineMoney } from '../../lib/numbers/argentine-amount';
import type { Rule } from '../../lib/rules/rules';

import {
  minimumPaymentDueDate,
  parseBillingDateInput,
  resolveBillingDate,
  resolvePaymentDateFromDueDay,
  shouldSendPaymentDueDate,
} from './billing.dates';
import { CONSUMER_IDENTIFICATION_THRESHOLD, requiresConsumerIdentification } from './billing.iva-receptor';
import { formatDocumentFlag, formatVoucherSubject, formatVoucherWithArticle } from './billing.mappers';
import type { BillingCommandInput } from './billing.schemas';
import type { VoucherKindDefinition } from './billing.types';

/**
 * Lo que una regla de A, B y C necesita ademas de la entrada: hoy (yyyymmdd), el comprobante, el CUIT emisor y la
 * cotizacion ya resuelta (con la oficial de ARCA, si no vino escrita). Sin `emitterCuit` o sin `exchangeRate` las
 * reglas que los usan no corren: en el asistente la cotizacion oficial no se sabe al preguntar.
 */
export interface BillingRuleContext {
  readonly emitterCuit?: number;
  readonly exchangeRate?: number;
  readonly today: string;
  readonly voucherKind: VoucherKindDefinition;
}

export type BillingRule = Rule<BillingCommandInput, BillingRuleContext>;

interface BillingDateWindow {
  readonly maxDaysAfter: number;
  readonly maxDaysBefore: number;
  readonly sameMonthWhenFuture: boolean;
}

/** Ventana de CbteFch respecto de hoy segun ARCA: 10016 el rango y 10152 el mes (WSFEv1 v4.7). */
function resolveBillingDateWindow(
  concept: BillingCommandInput['concept'] | undefined,
  voucherKind: VoucherKindDefinition,
): BillingDateWindow {
  if (voucherKind.isElectronicCredit) {
    return { maxDaysAfter: 1, maxDaysBefore: 5, sameMonthWhenFuture: true };
  }

  if (concept === 'productos') {
    return { maxDaysAfter: 5, maxDaysBefore: 5, sameMonthWhenFuture: true };
  }

  return { maxDaysAfter: 10, maxDaysBefore: 10, sameMonthWhenFuture: false };
}

/** ARCA 10016 y 10152 (WSFEv1 v4.7): la fecha del comprobante, cerca de hoy y, si es futura, en el mes (FCE y productos). */
export const BILLING_DATE_WINDOW_RULE: BillingRule = {
  check: (input, { today, voucherKind }) => {
    const billingDate = resolveBillingDate(input, today);
    const window = resolveBillingDateWindow(input.concept, voucherKind);
    const offset = diffArcaDatesInDays(today, billingDate);
    const label = formatArcaDateAsArgentineDate(billingDate);

    if (offset < -window.maxDaysBefore || offset > window.maxDaysAfter) {
      return `La fecha ${label} está fuera de rango para ${formatVoucherWithArticle(voucherKind)}: ARCA acepta hasta ${window.maxDaysBefore} días antes y ${window.maxDaysAfter} después de hoy.`;
    }

    if (window.sameMonthWhenFuture && offset > 0 && billingDate.slice(0, 6) !== today.slice(0, 6)) {
      return `La fecha ${label} es futura y cae en otro mes. Para ${formatVoucherWithArticle(voucherKind)} ARCA solo acepta fechas futuras dentro del mes actual.`;
    }

    return undefined;
  },
  fields: ['billingDate'],
  id: 'billing-date-window',
};

/**
 * ARCA 10032 (WSFEv1 v4.7): el inicio del servicio no es posterior al fin. Corre con las dos fechas: con una sola el CLI
 * frena antes (10031 y 10033, `validateConceptDateInputs`), y sin ninguna las dos son la fecha del comprobante. En el
 * asistente "Servicio desde" se pregunta antes que "Servicio hasta": no se compara contra un fin que falta.
 */
export const SERVICE_DATE_ORDER_RULE: BillingRule = {
  check: (input, { today }) => {
    if (input.concept === 'productos' || !input.serviceStartDate || !input.serviceEndDate) {
      return undefined;
    }

    const end = parseBillingDateInput(input.serviceEndDate, today);
    const start = parseBillingDateInput(input.serviceStartDate, today);

    return start > end ? 'La fecha de inicio de servicio no puede ser posterior a la fecha de fin.' : undefined;
  },
  fields: ['serviceStartDate', 'serviceEndDate'],
  id: 'service-date-order',
};

/**
 * El vencimiento del pago, no antes del minimo. En la factura FCE, ni antes de la fecha del comprobante ni de hoy
 * (10164, WSFEv1 v4.7). En el resto, no antes de la fecha del comprobante: propia, el manual no lo controla. Sin
 * `--vencimiento` ni `--dia` el CLI elige uno que cumple. Solo donde va el vencimiento (`shouldSendPaymentDueDate`).
 */
export const DUE_DATE_MINIMUM_RULE: BillingRule = {
  check: (input, { today, voucherKind }) => {
    if (!shouldSendPaymentDueDate(input, voucherKind) || (!input.paymentDueDate && !input.dueDay)) {
      return undefined;
    }

    const billingDate = resolveBillingDate(input, today);
    const minimum = minimumPaymentDueDate(billingDate, today, voucherKind);
    const due = input.paymentDueDate
      ? parseBillingDateInput(input.paymentDueDate, today)
      : resolvePaymentDateFromDueDay(input.dueDay as number, today);

    return due < minimum
      ? `El vencimiento de pago (${formatArcaDateAsArgentineDate(due)}) no puede ser anterior al ${formatArcaDateAsArgentineDate(minimum)}.`
      : undefined;
  },
  fields: ['paymentDueDate', 'billingDate'],
  id: 'due-date-minimum',
};

/**
 * ImpTotal = ImpTotConc + ImpOpEx + ImpNeto + ImpIVA (10048, WSFEv1 v4.7): exento y no gravado no pasan del total. La
 * C no los informa (10043, 10044): eso lo controla `resolveTaxAmounts`, con su propio texto.
 */
export const EXEMPT_UNTAXED_WITHIN_TOTAL_RULE: BillingRule = {
  check: (input, { voucherKind }) => {
    if (voucherKind.letter === 'c' || input.totalAmount === undefined) {
      return undefined;
    }

    const taxedTotal = new Big(input.totalAmount).minus(input.exemptAmount ?? 0).minus(input.untaxedAmount ?? 0);

    return taxedTotal.lt(0) ? 'El importe exento más el no gravado no puede superar el monto total.' : undefined;
  },
  fields: ['exemptAmount', 'untaxedAmount', 'totalAmount'],
  id: 'exempt-untaxed-within-total',
};

const MINIMUM_PERIOD_DATE = '20060101';

/**
 * Las fechas del periodo asociado que estan, en el orden en que las lee el CLI: una invalida falla igual en las tres
 * reglas del periodo. En el CLI van las dos (si falta una, frena `resolveAssociatedPeriod`); en el asistente "Período
 * desde" se pregunta antes que "Período hasta".
 */
function parsePeriod(
  input: Partial<BillingCommandInput>,
  today: string,
): { readonly from?: string; readonly to?: string } {
  const period = input.associatedPeriod;

  return {
    from: period?.desde ? parseBillingDateInput(period.desde, today) : undefined,
    to: period?.hasta ? parseBillingDateInput(period.hasta, today) : undefined,
  };
}

/** ARCA 10206 (WSFEv1 v4.7): el periodo asociado no empieza antes del 01/01/2006. */
export const ASSOCIATED_PERIOD_MINIMUM_RULE: BillingRule = {
  check: (input, { today }) => {
    const period = parsePeriod(input, today);

    return period.from !== undefined && period.from < MINIMUM_PERIOD_DATE
      ? 'El período asociado tiene que ser posterior al 01/01/2006.'
      : undefined;
  },
  fields: ['associatedPeriod.desde'],
  id: 'associated-period-minimum',
};

/** ARCA 10207 (WSFEv1 v4.7): en el periodo asociado, desde no es posterior a hasta. */
export const ASSOCIATED_PERIOD_ORDER_RULE: BillingRule = {
  check: (input, { today }) => {
    const period = parsePeriod(input, today);

    return period.from !== undefined && period.to !== undefined && period.from > period.to
      ? {
          message: 'En el período asociado, `--periodo-desde` no puede ser posterior a `--periodo-hasta`.',
          question: 'En el período asociado, "Período desde" no puede ser posterior a "Período hasta".',
        }
      : undefined;
  },
  fields: ['associatedPeriod.desde', 'associatedPeriod.hasta'],
  id: 'associated-period-order',
};

/** ARCA 10208 (WSFEv1 v4.7): el periodo asociado no termina despues de la fecha de la nota. */
export const ASSOCIATED_PERIOD_WITHIN_NOTE_RULE: BillingRule = {
  check: (input, { today, voucherKind }) => {
    const period = parsePeriod(input, today);
    const billingDate = resolveBillingDate(input, today);

    return period.to !== undefined && period.to > billingDate
      ? `El período asociado no puede terminar después de la fecha de ${formatVoucherWithArticle(voucherKind)} (${formatArcaDateAsArgentineDate(billingDate)}).`
      : undefined;
  },
  fields: ['associatedPeriod.hasta', 'billingDate'],
  id: 'associated-period-within-note',
};

/**
 * La nota no es anterior al comprobante que ajusta. Propia: en FCE es la 10159, pero en las notas comunes ARCA acepta
 * un asociado posterior del mismo mes (10210, WSFEv1 v4.7) y testing aprobo una NC B anterior a su factura. Una nota
 * anterior a lo que ajusta es casi seguro un error. Es la misma regla desde los dos lados: la fecha del asociado
 * (`--afecha`) y la de la nota (`--fecha`).
 */
export const ASSOCIATED_NOT_AFTER_NOTE_RULE: BillingRule = {
  check: (input, { today, voucherKind }) => {
    const rawDate = input.associatedVoucher?.fecha;

    if (!rawDate) {
      return undefined;
    }

    const associatedDate = parseBillingDateInput(rawDate, today);
    const billingDate = resolveBillingDate(input, today);

    return associatedDate > billingDate
      ? `La fecha del comprobante asociado (${formatArcaDateAsArgentineDate(associatedDate)}) no puede ser posterior a la de ${formatVoucherWithArticle(voucherKind)} (${formatArcaDateAsArgentineDate(billingDate)}).`
      : undefined;
  },
  fields: ['associatedVoucher.fecha', 'billingDate'],
  id: 'associated-not-after-note',
};

/** ARCA 10069 (WSFEv1 v4.7): el documento del receptor no puede ser el del emisor. */
export const RECEIVER_NOT_EMITTER_RULE: BillingRule = {
  check: (input, { emitterCuit }) => {
    if (
      emitterCuit === undefined ||
      (input.documentType !== 'cuit' && input.documentType !== 'cuil') ||
      input.documentNumber !== emitterCuit
    ) {
      return undefined;
    }

    return {
      hint: `Revisá \`${formatDocumentFlag(input.documentType)}\`: es el CUIT de la config, no el de tu cliente.`,
      message: `El receptor no puede ser el mismo CUIT que emite (${emitterCuit}): ARCA lo rechaza (error 10069).`,
    };
  },
  fields: ['documentNumber'],
  id: 'receiver-not-emitter',
};

/**
 * RG 5700/2025 (ARCA 10015, WSFEv1 v4.7): desde el tope, el consumidor final va identificado. Necesita la cotizacion
 * ya resuelta: sin ella (en el asistente, al preguntar) no corre, y el documento lo pide el flujo cuando se sabe el
 * total en pesos (REV-66).
 */
export const CONSUMER_IDENTIFICATION_THRESHOLD_RULE: BillingRule = {
  check: (input, { exchangeRate, voucherKind }) => {
    if (
      exchangeRate === undefined ||
      input.totalAmount === undefined ||
      input.documentType !== 'consumidor-final' ||
      !requiresConsumerIdentification(input.totalAmount * exchangeRate)
    ) {
      return undefined;
    }

    const subject = `${formatVoucherSubject(voucherKind)} de ${formatArgentineMoney(CONSUMER_IDENTIFICATION_THRESHOLD)} o más`;

    return {
      message: `${subject} requiere identificar al consumidor final. Usá \`--dni\`, \`--cuit\` o \`--cuil\`.`,
      question: `${subject} requiere identificar al consumidor final.`,
    };
  },
  fields: ['totalAmount'],
  id: 'consumer-identification-threshold',
};

/** Las de las fechas del comprobante, en el orden en que las controla `resolveBillingDateRange`. */
const BILLING_DATE_RULES: readonly BillingRule[] = [
  BILLING_DATE_WINDOW_RULE,
  SERVICE_DATE_ORDER_RULE,
  DUE_DATE_MINIMUM_RULE,
];

/** Las del periodo asociado, en el orden de `resolveAssociatedPeriod`. */
export const ASSOCIATED_PERIOD_RULES: readonly BillingRule[] = [
  ASSOCIATED_PERIOD_MINIMUM_RULE,
  ASSOCIATED_PERIOD_ORDER_RULE,
  ASSOCIATED_PERIOD_WITHIN_NOTE_RULE,
];

/**
 * Todas las reglas entre campos de A, B y C: las usa el CLI (cada `resolve*` las suyas, con `assertRules`) y el
 * asistente (`ruleValidator` en cada pregunta que escribe un campo, y `finalize` sobre la entrada final).
 */
export const BILLING_RULES: readonly BillingRule[] = [
  ...BILLING_DATE_RULES,
  EXEMPT_UNTAXED_WITHIN_TOTAL_RULE,
  ...ASSOCIATED_PERIOD_RULES,
  ASSOCIATED_NOT_AFTER_NOTE_RULE,
  RECEIVER_NOT_EMITTER_RULE,
  CONSUMER_IDENTIFICATION_THRESHOLD_RULE,
];
