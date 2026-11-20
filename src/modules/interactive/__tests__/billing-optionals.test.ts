import { describe, expect, it } from 'vitest';

import { getVoucherKindByShortcut } from '../../billing/voucher-kind-map';
import {
  type AdvancedOptionKey,
  type AdvancedOptions,
  billingOptionals,
  type BillingOptionalsContext,
  initialAdvancedOptions,
} from '../billing-optionals';
import { composeOptionals } from '../optional-group';
import type { WizardStep } from '../wizard';

/** Una pregunta por opcional que responde lo que se le pasa: alcanza para componer sin `prompts`. */
const answering = (name: string): (() => Array<WizardStep<AdvancedOptions>>) => {
  return () => [{ name, run: async () => ({}) }];
};

const OPTIONALS = billingOptionals({
  alicuota: answering('alicuota'),
  consumidor: answering('consumidor'),
  divisas: answering('divisas'),
  exento: answering('exento'),
  fecha: answering('fecha'),
  servicio: answering('servicio'),
  transferencia: answering('transferencia'),
  vencimiento: answering('vencimiento'),
});

const PESOS: AdvancedOptions = { currencyCode: 'ARS', sameCurrency: false };

function context(shortcut: string, overrides: Partial<BillingOptionalsContext> = {}): BillingOptionalsContext {
  const voucherKind = getVoucherKindByShortcut(shortcut as never)!;

  return {
    concept: 'servicios',
    defaultIvaRate: '21',
    rules: { context: { today: '20261118', voucherKind }, draft: (patch) => patch },
    voucherKind,
    ...overrides,
  };
}

const offered = (current: BillingOptionalsContext): AdvancedOptionKey[] =>
  OPTIONALS.filter((option) => option.available(current)).map((option) => option.key);

const describeOf = (key: AdvancedOptionKey, current: AdvancedOptions, at = context('fc')): string =>
  OPTIONALS.find((option) => option.key === key)!.describe(current, at);

describe('billingOptionals', () => {
  it('ofrece lo de cada comprobante, en el orden de la selección', () => {
    expect(offered(context('fa', { consumer: true }))).toEqual([
      'consumidor',
      'fecha',
      'alicuota',
      'divisas',
      'exento',
      'servicio',
      'vencimiento',
    ]);
    expect(offered(context('fc', { concept: 'productos' }))).toEqual(['fecha', 'divisas']);
    expect(offered(context('fcea', { fixedCurrency: true }))).toEqual([
      'fecha',
      'alicuota',
      'exento',
      'servicio',
      'vencimiento',
      'transferencia',
    ]);
    // Las notas FCE no llevan vencimiento; lo oculto por el flujo no se ofrece.
    expect(offered(context('ncea', { hidden: ['alicuota', 'transferencia'] }))).toEqual([
      'fecha',
      'divisas',
      'exento',
      'servicio',
    ]);
  });

  it('solo la alícuota y el exento siguen al comprobante del que se copian; el exento, también al monto (REV-70)', () => {
    const keys = (extra: Partial<BillingOptionalsContext> = {}) =>
      Object.fromEntries(
        OPTIONALS.filter((option) => option.resetWhen).map((option) => [
          option.key,
          option.resetWhen?.(context('fa', extra)),
        ]),
      );

    expect(keys({ copiedFrom: 'fa:3:14' })).toEqual({ alicuota: 'fa:3:14', exento: 'fa:3:14|' });
    expect(keys({ copiedFrom: 'fa:3:14', exemptFrom: 'preguntado' })).toEqual({
      alicuota: 'fa:3:14',
      exento: 'fa:3:14|preguntado',
    });
    expect(keys()).toEqual({ alicuota: '', exento: '|' });
  });

  // #8 de la auditoria del 19/11: sin fechas de servicio, el CLI usa la fecha del comprobante.
  it('"Período del servicio" describe la fecha que va', () => {
    expect(describeOf('servicio', PESOS)).toBe('hoy');
    expect(describeOf('servicio', { ...PESOS, billingDate: '14/11/2026' })).toBe('14/11/2026');
    expect(
      describeOf('servicio', {
        ...PESOS,
        billingDate: '14/11/2026',
        serviceEndDate: '31/10/2026',
        serviceStartDate: '01/10/2026',
      }),
    ).toBe('01/10/2026 al 31/10/2026');
  });

  it('lo que deja de aplicar no llega: exento en la C, fechas de servicio y vencimiento en productos', () => {
    const loaded: AdvancedOptions = {
      ...PESOS,
      exemptAmount: 10,
      paymentDueDate: '30/11/2026',
      serviceEndDate: '31/10/2026',
      serviceStartDate: '01/10/2026',
      untaxedAmount: 5,
    };

    expect(composeOptionals(loaded, [], OPTIONALS, context('fc', { concept: 'productos' }), new Map())).toEqual({
      ...PESOS,
      exemptAmount: undefined,
      paymentDueDate: undefined,
      serviceEndDate: undefined,
      serviceStartDate: undefined,
      untaxedAmount: undefined,
    });
  });

  it('en pesos arranca sin cotización, aunque la config tenga una', () => {
    expect(initialAdvancedOptions({ cotizacionPorDefecto: 1200, monedaPorDefecto: 'PES' })).toStrictEqual({
      currencyCode: 'ARS',
      sameCurrency: false,
    });
  });
});
