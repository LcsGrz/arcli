import { describe, expect, it } from 'vitest';

import { InputValidationError } from '../../../lib/errors/app-error';
import { assertRules, findRuleFailure, type RuleFailure } from '../../../lib/rules/rules';
import {
  ASSOCIATED_NOT_AFTER_NOTE_RULE,
  ASSOCIATED_PERIOD_MINIMUM_RULE,
  ASSOCIATED_PERIOD_ORDER_RULE,
  ASSOCIATED_PERIOD_WITHIN_NOTE_RULE,
  BILLING_DATE_WINDOW_RULE,
  BILLING_RULES,
  type BillingRule,
  type BillingRuleContext,
  CONSUMER_IDENTIFICATION_THRESHOLD_RULE,
  DUE_DATE_MINIMUM_RULE,
  EXEMPT_UNTAXED_WITHIN_TOTAL_RULE,
  latestBillingDate,
  RECEIVER_NOT_EMITTER_RULE,
  SERVICE_DATE_ORDER_RULE,
} from '../billing.rules';
import type { BillingCommandInput } from '../billing.schemas';
import type { VoucherKindDefinition, VoucherShortcut } from '../billing.types';
import { getVoucherKindByShortcut } from '../voucher-kind-map';

const TODAY = '20261118';
const kind = (shortcut: VoucherShortcut): VoucherKindDefinition =>
  getVoucherKindByShortcut(shortcut) as VoucherKindDefinition;
const context = (shortcut: VoucherShortcut, extra: Partial<BillingRuleContext> = {}): BillingRuleContext => ({
  today: TODAY,
  voucherKind: kind(shortcut),
  ...extra,
});
const check = (rule: BillingRule, input: Partial<BillingCommandInput>, ruleContext: BillingRuleContext) =>
  rule.check(input, ruleContext);
const messageOf = (result: RuleFailure | string | undefined) => (typeof result === 'string' ? result : result?.message);

describe('reglas de A, B y C (billing.rules.ts)', () => {
  it('billing-date-window (10016, 10152): 10 dias en servicios, 5 en productos, en el mes si es futura en FCE', () => {
    expect(check(BILLING_DATE_WINDOW_RULE, { billingDate: '28/11/2026', concept: 'servicios' }, context('fc'))).toBe(
      undefined,
    );
    expect(
      messageOf(check(BILLING_DATE_WINDOW_RULE, { billingDate: '29/11/2026', concept: 'servicios' }, context('fc'))),
    ).toBe(
      'La fecha 29/11/2026 está fuera de rango para la factura C: ARCA acepta hasta 10 días antes y 10 después de hoy.',
    );
    expect(
      messageOf(check(BILLING_DATE_WINDOW_RULE, { billingDate: '24/11/2026', concept: 'productos' }, context('fc'))),
    ).toMatch(/fuera de rango.*5 días antes y 5 después/);
    // Sin `--fecha`, hoy.
    expect(check(BILLING_DATE_WINDOW_RULE, { concept: 'productos' }, context('fc'))).toBeUndefined();
    expect(
      messageOf(
        check(
          BILLING_DATE_WINDOW_RULE,
          { billingDate: '01/12/2026', concept: 'productos' },
          context('fc', { today: '20261130' }),
        ),
      ),
    ).toMatch(/es futura y cae en otro mes/);
  });

  it('service-date-order (10032): desde no es posterior a hasta; con una sola fecha no corre (la frena la 10031)', () => {
    expect(
      check(SERVICE_DATE_ORDER_RULE, { serviceEndDate: '30/11/2026', serviceStartDate: '01/11/2026' }, context('fc')),
    ).toBeUndefined();
    expect(
      check(SERVICE_DATE_ORDER_RULE, { serviceEndDate: '01/11/2026', serviceStartDate: '30/11/2026' }, context('fc')),
    ).toBe('La fecha de inicio de servicio no puede ser posterior a la fecha de fin.');
    expect(check(SERVICE_DATE_ORDER_RULE, { serviceStartDate: '19/11/2026' }, context('fc'))).toBeUndefined();
    expect(
      check(
        SERVICE_DATE_ORDER_RULE,
        { concept: 'productos', serviceEndDate: '01/11/2026', serviceStartDate: '30/11/2026' },
        context('fc'),
      ),
    ).toBeUndefined();
  });

  it('due-date-minimum (10164 en FCE): no antes de la fecha del comprobante, ni de hoy en la factura FCE', () => {
    expect(
      check(DUE_DATE_MINIMUM_RULE, { billingDate: '15/11/2026', paymentDueDate: '15/11/2026' }, context('fc')),
    ).toBe(undefined);
    expect(
      check(DUE_DATE_MINIMUM_RULE, { billingDate: '15/11/2026', paymentDueDate: '14/11/2026' }, context('fc')),
    ).toBe('El vencimiento de pago (14/11/2026) no puede ser anterior al 15/11/2026.');
    expect(
      check(DUE_DATE_MINIMUM_RULE, { billingDate: '15/11/2026', paymentDueDate: '16/11/2026' }, context('fceb')),
    ).toBe('El vencimiento de pago (16/11/2026) no puede ser anterior al 18/11/2026.');
    // Sin vencimiento el CLI elige uno que cumple; en productos no va.
    expect(check(DUE_DATE_MINIMUM_RULE, { billingDate: '15/11/2026' }, context('fceb'))).toBeUndefined();
    expect(
      check(DUE_DATE_MINIMUM_RULE, { concept: 'productos', paymentDueDate: '01/01/2020' }, context('fc')),
    ).toBeUndefined();
    // `--dia` se resuelve igual que en el CLI: el 10 desde el 18/11 es el 10/12.
    expect(check(DUE_DATE_MINIMUM_RULE, { billingDate: '15/11/2026', dueDay: 10 }, context('fc'))).toBeUndefined();
  });

  it('exempt-untaxed-within-total (10048): exento más no gravado no pasa del total; la C no corre', () => {
    expect(
      check(
        EXEMPT_UNTAXED_WITHIN_TOTAL_RULE,
        { exemptAmount: 800, totalAmount: 1000, untaxedAmount: 200 },
        context('fb'),
      ),
    ).toBeUndefined();
    expect(
      check(
        EXEMPT_UNTAXED_WITHIN_TOTAL_RULE,
        { exemptAmount: 800, totalAmount: 1000, untaxedAmount: 200.01 },
        context('fb'),
      ),
    ).toBe('El importe exento más el no gravado no puede superar el monto total.');
    expect(check(EXEMPT_UNTAXED_WITHIN_TOTAL_RULE, { exemptAmount: 800 }, context('fb'))).toBeUndefined();
    expect(
      check(EXEMPT_UNTAXED_WITHIN_TOTAL_RULE, { exemptAmount: 1800, totalAmount: 1000 }, context('fc')),
    ).toBeUndefined();
  });

  it('associated-period-minimum (10206): el periodo empieza desde el 01/01/2006', () => {
    const period = (desde: string) => ({ associatedPeriod: { desde, hasta: '31/01/2006' } });

    expect(check(ASSOCIATED_PERIOD_MINIMUM_RULE, period('01/01/2006'), context('ncc'))).toBeUndefined();
    expect(check(ASSOCIATED_PERIOD_MINIMUM_RULE, period('31/12/2005'), context('ncc'))).toBe(
      'El período asociado tiene que ser posterior al 01/01/2006.',
    );
  });

  it('associated-period-order (10207): desde no es posterior a hasta, y en el asistente nombra las preguntas', () => {
    expect(
      check(
        ASSOCIATED_PERIOD_ORDER_RULE,
        { associatedPeriod: { desde: '01/11/2026', hasta: '01/11/2026' } },
        context('ncc'),
      ),
    ).toBeUndefined();
    expect(
      check(
        ASSOCIATED_PERIOD_ORDER_RULE,
        { associatedPeriod: { desde: '02/11/2026', hasta: '01/11/2026' } },
        context('ncc'),
      ),
    ).toEqual({
      message: 'En el período asociado, `--periodo-desde` no puede ser posterior a `--periodo-hasta`.',
      question: 'En el período asociado, "Período desde" no puede ser posterior a "Período hasta".',
    });
  });

  it('associated-period-within-note (10208): el periodo no termina despues de la nota (sin fecha, hoy)', () => {
    const period = { associatedPeriod: { desde: '01/11/2026', hasta: '18/11/2026' } };

    expect(check(ASSOCIATED_PERIOD_WITHIN_NOTE_RULE, period, context('ncc'))).toBeUndefined();
    expect(check(ASSOCIATED_PERIOD_WITHIN_NOTE_RULE, { ...period, billingDate: '17/11/2026' }, context('ncc'))).toBe(
      'El período asociado no puede terminar después de la fecha de la nota de crédito C (17/11/2026).',
    );
    expect(
      check(ASSOCIATED_PERIOD_WITHIN_NOTE_RULE, { associatedPeriod: { desde: '01/11/2026' } }, context('ncc')),
    ).toBe(undefined);
  });

  it('associated-not-after-note (propia): el asociado no es posterior a la nota', () => {
    const associatedVoucher = { fecha: '18/11/2026', numero: 1, puntoVenta: 3, shortcut: 'fc' as const };

    expect(check(ASSOCIATED_NOT_AFTER_NOTE_RULE, { associatedVoucher }, context('ncc'))).toBeUndefined();
    expect(
      check(ASSOCIATED_NOT_AFTER_NOTE_RULE, { associatedVoucher, billingDate: '17/11/2026' }, context('ncc')),
    ).toBe(
      'La fecha del comprobante asociado (18/11/2026) no puede ser posterior a la de la nota de crédito C (17/11/2026).',
    );
    expect(
      check(
        ASSOCIATED_NOT_AFTER_NOTE_RULE,
        { associatedVoucher: { ...associatedVoucher, fecha: undefined } },
        context('ncc'),
      ),
    ).toBeUndefined();
  });

  it('associated-period-within-note sin fecha de la nota: hoy por defecto, o la mas tardia si todavia no se eligio', () => {
    const period = { associatedPeriod: { desde: '01/11/2026', hasta: '25/11/2026' } };

    // Por defecto (finalize), hoy: sugiere el opcional en el asistente; el CLI sigue con su texto.
    expect(check(ASSOCIATED_PERIOD_WITHIN_NOTE_RULE, period, context('ncc'))).toEqual({
      message: 'El período asociado no puede terminar después de la fecha de la nota de crédito C (18/11/2026).',
      question:
        'El período asociado no puede terminar después de la fecha de la nota de crédito C (18/11/2026): escribí un "Período hasta" hasta el 18/11/2026, o volvé y elegí una fecha posterior en "Fecha del comprobante" de los opcionales.',
    });
    // Al preguntar el periodo (la fecha se elige despues): contra hoy mas 10 dias (servicios).
    const undecided = context('ncc', { undecidedBillingDate: true });

    expect(check(ASSOCIATED_PERIOD_WITHIN_NOTE_RULE, period, undecided)).toBeUndefined();
    expect(
      check(
        ASSOCIATED_PERIOD_WITHIN_NOTE_RULE,
        { associatedPeriod: { desde: '01/11/2026', hasta: '29/11/2026' } },
        undecided,
      ),
    ).toMatchObject({
      question:
        'El período asociado no puede terminar después del 28/11/2026: es la fecha más tardía que ARCA acepta para la nota de crédito C.',
    });
    // En productos, 5 dias.
    expect(check(ASSOCIATED_PERIOD_WITHIN_NOTE_RULE, { ...period, concept: 'productos' }, undecided)).toMatchObject({
      question: expect.stringContaining('después del 23/11/2026'),
    });
    // Con la fecha elegida, la comparacion es exacta aunque el contexto diga que no se eligio.
    expect(check(ASSOCIATED_PERIOD_WITHIN_NOTE_RULE, { ...period, billingDate: '25/11/2026' }, undecided)).toBe(
      undefined,
    );
    // Primero la fecha: `finalize` vuelve a "Fecha del comprobante" si se eligio; si no, al periodo.
    expect(ASSOCIATED_PERIOD_WITHIN_NOTE_RULE.fields).toEqual(['billingDate', 'associatedPeriod.hasta']);
  });

  it('associated-not-after-note sin fecha de la nota: hoy por defecto, o la mas tardia si todavia no se eligio', () => {
    const associatedVoucher = { fecha: '25/11/2026', numero: 1, puntoVenta: 50, shortcut: 'fc' as const };

    expect(check(ASSOCIATED_NOT_AFTER_NOTE_RULE, { associatedVoucher }, context('ncc'))).toEqual({
      message:
        'La fecha del comprobante asociado (25/11/2026) no puede ser posterior a la de la nota de crédito C (18/11/2026).',
      question:
        'La fecha del comprobante asociado (25/11/2026) no puede ser posterior a la de la nota de crédito C (18/11/2026): escribí una hasta el 18/11/2026, o volvé y elegí una fecha posterior en "Fecha del comprobante" de los opcionales.',
    });
    expect(
      check(ASSOCIATED_NOT_AFTER_NOTE_RULE, { associatedVoucher }, context('ncc', { undecidedBillingDate: true })),
    ).toBeUndefined();
    expect(
      check(
        ASSOCIATED_NOT_AFTER_NOTE_RULE,
        { associatedVoucher: { ...associatedVoucher, fecha: '29/11/2026' } },
        context('ncc', { undecidedBillingDate: true }),
      ),
    ).toMatchObject({
      question:
        'La fecha del comprobante asociado (29/11/2026) no puede ser posterior al 28/11/2026: es la fecha más tardía que ARCA acepta para la nota de crédito C.',
    });
    expect(ASSOCIATED_NOT_AFTER_NOTE_RULE.fields).toEqual(['billingDate', 'associatedVoucher.fecha']);
  });

  it('latestBillingDate: la fecha mas tardia de la ventana (10016, 10152)', () => {
    expect(latestBillingDate('servicios', kind('ncc'), TODAY)).toBe('20261128');
    expect(latestBillingDate(undefined, kind('ncc'), TODAY)).toBe('20261128');
    expect(latestBillingDate('productos', kind('ncc'), TODAY)).toBe('20261123');
    // Futura en el mes: productos y FCE no pasan del fin de mes.
    expect(latestBillingDate('productos', kind('ncc'), '20261128')).toBe('20261130');
    expect(latestBillingDate('servicios', kind('fceb'), '20261130')).toBe('20261130');
    expect(latestBillingDate('servicios', kind('fceb'), TODAY)).toBe('20261119');
  });

  it('receiver-not-emitter (10069): el receptor no es el CUIT que emite', () => {
    const emitter = context('fa', { emitterCuit: 20111111112 });

    expect(check(RECEIVER_NOT_EMITTER_RULE, { documentNumber: 30709965812, documentType: 'cuit' }, emitter)).toBe(
      undefined,
    );
    expect(check(RECEIVER_NOT_EMITTER_RULE, { documentNumber: 20111111112, documentType: 'cuit' }, emitter)).toEqual({
      hint: 'Revisá `--cuit`: es el CUIT de la config, no el de tu cliente.',
      message: 'El receptor no puede ser el mismo CUIT que emite (20111111112): ARCA lo rechaza (error 10069).',
    });
    // Sin el CUIT emisor no corre; un DNI no es un CUIT.
    expect(
      check(RECEIVER_NOT_EMITTER_RULE, { documentNumber: 20111111112, documentType: 'cuit' }, context('fa')),
    ).toBeUndefined();
    expect(check(RECEIVER_NOT_EMITTER_RULE, { documentNumber: 20111111112, documentType: 'dni' }, emitter)).toBe(
      undefined,
    );
    // Un CUIL con el numero del CUIT emisor tambien (el CLI lo frena igual).
    expect(check(RECEIVER_NOT_EMITTER_RULE, { documentNumber: 20111111112, documentType: 'cuil' }, emitter)).toEqual({
      hint: 'Revisá `--cuil`: es el CUIT de la config, no el de tu cliente.',
      message: 'El receptor no puede ser el mismo CUIT que emite (20111111112): ARCA lo rechaza (error 10069).',
    });
  });

  it('consumer-identification-threshold (RG 5700/2025): desde el tope, con la cotizacion resuelta', () => {
    const consumer = { documentType: 'consumidor-final' as const };

    expect(
      check(
        CONSUMER_IDENTIFICATION_THRESHOLD_RULE,
        { ...consumer, totalAmount: 9_999_999.99 },
        context('fb', { exchangeRate: 1 }),
      ),
    ).toBeUndefined();
    expect(
      check(
        CONSUMER_IDENTIFICATION_THRESHOLD_RULE,
        { ...consumer, totalAmount: 10_000 },
        context('fb', { exchangeRate: 1000 }),
      ),
    ).toEqual({
      message:
        'La factura B de $ 10.000.000 o más requiere identificar al consumidor final. Usá `--dni`, `--cuit` o `--cuil`.',
      question: 'La factura B de $ 10.000.000 o más requiere identificar al consumidor final.',
    });
    // Sin cotizacion (el asistente al preguntar) no corre.
    expect(
      check(CONSUMER_IDENTIFICATION_THRESHOLD_RULE, { ...consumer, totalAmount: 20_000_000 }, context('fb')),
    ).toBeUndefined();
  });

  it('cada regla tiene un id unico y campos', () => {
    const ids = BILLING_RULES.map((rule) => rule.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(BILLING_RULES.every((rule) => rule.fields.length > 0)).toBe(true);
  });
});

describe('assertRules y findRuleFailure', () => {
  it('corre en orden: la primera que falla lanza el texto del CLI con su sugerencia', () => {
    const thrown = (() => {
      try {
        assertRules(
          BILLING_RULES,
          { documentNumber: 20111111112, documentType: 'cuit' },
          context('fa', { emitterCuit: 20111111112 }),
        );
      } catch (error) {
        return error;
      }

      return undefined;
    })();

    expect(thrown).toBeInstanceOf(InputValidationError);
    expect((thrown as InputValidationError).message).toMatch(/mismo CUIT que emite/);
    expect((thrown as InputValidationError).suggestion).toMatch(/Revisá `--cuit`/);
    expect(() => assertRules(BILLING_RULES, {}, context('fc'))).not.toThrow();
    expect(
      findRuleFailure(
        BILLING_RULES,
        { serviceEndDate: '01/11/2026', serviceStartDate: '30/11/2026', totalAmount: 1, exemptAmount: 2 },
        context('fb'),
      )?.rule.id,
    ).toBe('service-date-order');
  });

  it('una fecha mal escrita lanza el mismo error que el CLI', () => {
    expect(() =>
      SERVICE_DATE_ORDER_RULE.check({ serviceEndDate: '32/11/2026', serviceStartDate: '01/11/2026' }, context('fc')),
    ).toThrow(/La fecha "32\/11\/2026" no es válida/);
  });
});
