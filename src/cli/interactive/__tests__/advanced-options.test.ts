import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatDateAsArcaDate } from '../../../lib/dates/arca-date';
import { getVoucherKindByShortcut } from '../../../modules/billing/voucher-kind-map';
import {
  type AdvancedOptions,
  type BillingOptionalsContext,
  initialAdvancedOptions,
} from '../../../modules/interactive/billing-optionals';
import { BACK, runWizard } from '../../../modules/interactive/wizard';
import { billingOptionalsStep } from '../advanced-options';
import { askPaymentCurrency } from '../steps/currency';

import { createScript, rejecting } from './script';

let script = createScript([]);

vi.mock('../prompts', () => ({
  askTextStep: (...args: Parameters<typeof script.askTextStep>) => script.askTextStep(...args),
  chooseManyStep: (...args: Parameters<typeof script.chooseManyStep>) => script.chooseManyStep(...args),
  chooseStep: (...args: Parameters<typeof script.chooseStep>) => script.chooseStep(...args),
}));

const OPTIONALS = /Agregamos/;
const PESOS = { currencyCode: 'ARS', sameCurrency: false } as const;

/** El grupo de opcionales solo, como un asistente de un paso: BACK si se vuelve desde la seleccion. */
async function askAdvancedOptions(initial: AdvancedOptions, context: BillingOptionalsContext) {
  const state = await runWizard(
    [
      billingOptionalsStep<{ readonly advanced: AdvancedOptions }>({
        context: () => context,
        name: 'opcionales',
        read: (current) => current.advanced,
        write: (advanced) => ({ advanced }),
      }),
    ],
    { advanced: initial },
  );

  return state ? state.advanced : BACK;
}

function context(shortcut: string, overrides: Record<string, unknown> = {}): BillingOptionalsContext {
  const voucherKind = getVoucherKindByShortcut(shortcut as never)!;

  return {
    concept: 'servicios' as const,
    defaultIvaRate: '21' as const,
    // Las reglas con el comprobante solo: lo que escribe cada pregunta y lo demas como el CLI sin flags.
    rules: {
      context: { today: formatDateAsArcaDate(new Date()), voucherKind },
      draft: (patch) => ({ concept: 'servicios', shortcut: voucherKind.shortcut, ...patch }),
    },
    voucherKind,
    ...overrides,
  };
}

/** Las descripciones de la seleccion la vez `call`, por nombre de la opcion. */
function descriptions(call: number): Record<string, string | undefined> {
  return Object.fromEntries(
    (script.chooseManyStep.mock.calls[call]?.[1] ?? []).map((choice) => [choice.name, choice.description]),
  );
}

afterEach(() => {
  vi.useRealTimers();
  expect(script.remaining()).toBe(0);
});

describe('askAdvancedOptions: volver desde cada opcional', () => {
  it.each([
    ['la fecha', 'Fecha del comprobante', /Fecha del comprobante/],
    ['la alícuota', 'Alícuota de IVA', /Alícuota/],
    ['la moneda', 'Moneda extranjera', /Moneda del comprobante/],
    ['el exento', 'Importe exento', /exenta/],
    ['el desde', 'Período', /Servicio desde/],
    ['el vencimiento', 'Vencimiento', /Vencimiento del pago/],
    ['la modalidad', 'Modalidad', /Modalidad de transferencia/],
  ] as const)(
    'volver desde la primera pregunta de %s vuelve a la seleccion con esa opcion marcada y sin cambios',
    async (_, name, question) => {
      script = createScript([
        [OPTIONALS, [name]],
        [question, BACK],
        [OPTIONALS, []],
      ]);

      expect(await askAdvancedOptions(PESOS, context('fcea'))).toEqual(PESOS);
      expect(script.chooseManyStep.mock.calls[1]?.[2]).toHaveLength(1);
    },
  );

  // REV-60: dentro de un opcional, "Volver" va a la pregunta anterior, con lo respondido marcado o escrito.
  it.each([
    [
      'cómo te pagan',
      'Moneda extranjera',
      [
        [/Moneda del comprobante/, 'Euro'],
        [/Cómo te pagan/, BACK],
        [/Moneda del comprobante/, 'Euro'],
        [/Cómo te pagan/, 'En euros'],
      ],
      { currencyCode: 'EUR', sameCurrency: true },
    ],
    [
      'la cotización',
      'Moneda extranjera',
      [
        [/Moneda del comprobante/, 'Dólar'],
        [/Cómo te pagan/, 'En pesos'],
        [/Cotización de USD/, BACK],
        [/Cómo te pagan/, 'En pesos'],
        [/Cotización de USD/, '1.200'],
      ],
      { currencyCode: 'USD', exchangeRate: 1200, sameCurrency: false },
    ],
    [
      'el no gravado',
      'Importe exento',
      [
        [/exenta/, '10'],
        [/no gravada/, BACK],
        [/exenta/, '10'],
        [/no gravada/, ''],
      ],
      { exemptAmount: 10, untaxedAmount: undefined },
    ],
    [
      'el hasta',
      'Período',
      [
        [/Servicio desde/, '01/10/2026'],
        [/Servicio hasta/, BACK],
        [/Servicio desde/, '01/10/2026'],
        [/Servicio hasta/, '31/10/2026'],
      ],
      { serviceEndDate: '31/10/2026', serviceStartDate: '01/10/2026' },
    ],
  ] as const)('volver desde %s vuelve a la pregunta anterior del mismo opcional', async (_, name, steps, expected) => {
    script = createScript([[OPTIONALS, [name]], ...steps]);

    expect(await askAdvancedOptions(PESOS, context('fa'))).toMatchObject(expected);
    expect(script.chooseManyStep).toHaveBeenCalledTimes(1);
  });

  it('volver desde la primera pregunta de un opcional va a la ultima del opcional anterior', async () => {
    script = createScript([
      [OPTIONALS, ['Importe exento', 'Período']],
      [/exenta/, '10'],
      [/no gravada/, '5'],
      [/Servicio desde/, BACK],
      [/no gravada/, '6'],
      [/Servicio desde/, '01/10/2026'],
      [/Servicio hasta/, '31/10/2026'],
    ]);

    expect(await askAdvancedOptions(PESOS, context('fa'))).toMatchObject({ exemptAmount: 10, untaxedAmount: 6 });
    // El no gravado arranca escrito con lo respondido antes.
    expect(script.askTextStep.mock.calls[3]?.[1]).toMatchObject({ previousAnswer: '5' });
  });

  it('al volver, la moneda y cómo te pagan arrancan marcadas; si cambia la fecha, no se olvidan', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T12:00:00-03:00'));
    script = createScript([
      [OPTIONALS, ['Moneda extranjera', 'Fecha']],
      [/Fecha del comprobante/, '01/10/2026'],
      [/Moneda del comprobante/, 'Euro'],
      [/Cómo te pagan/, 'En pesos'],
      [/Cotización de EUR/, BACK],
      [/Cómo te pagan/, BACK],
      [/Moneda del comprobante/, BACK],
      [/Fecha del comprobante/, '02/10/2026'],
      [/Moneda del comprobante/, 'Euro'],
      [/Cómo te pagan/, 'En pesos'],
      [/Cotización de EUR/, '1.600,5'],
    ]);

    expect(await askAdvancedOptions(PESOS, context('fa'))).toMatchObject({
      billingDate: '02/10/2026',
      currencyCode: 'EUR',
      exchangeRate: 1600.5,
    });
    // La moneda y cómo te pagan no dependen de la fecha.
    expect(script.chooseStep.mock.calls.map((call) => call[2])).toEqual([
      'PES',
      undefined,
      'pesos',
      'EUR',
      'EUR',
      'pesos',
    ]);
    expect(script.askTextStep.mock.calls.map((call) => call[1]?.previousAnswer)).toEqual([
      undefined,
      undefined,
      '01/10/2026',
      undefined,
    ]);
  });

  it('volver a la seleccion deja aplicado lo respondido; un opcional a medias no, pero arranca escrito', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T12:00:00-03:00'));
    script = createScript([
      [OPTIONALS, ['Importe exento', 'Fecha']],
      [/Fecha del comprobante/, '01/10/2026'],
      [/exenta/, '100'],
      [/no gravada/, BACK],
      [/exenta/, BACK],
      [/Fecha del comprobante/, BACK],
      [OPTIONALS, ['Importe exento', 'Fecha']],
      [/Fecha del comprobante/, '01/10/2026'],
      [/exenta/, '100'],
      [/no gravada/, ''],
    ]);

    expect(await askAdvancedOptions(PESOS, context('fa'))).toMatchObject({
      billingDate: '01/10/2026',
      exemptAmount: 100,
    });
    expect(descriptions(1)).toMatchObject({
      'Fecha del comprobante': '01/10/2026',
      'Importe exento o no gravado': 'sin exento ni no gravado',
    });
    expect(script.askTextStep.mock.calls.slice(5).map((call) => call[1]?.previousAnswer)).toEqual([
      '01/10/2026',
      '100',
      undefined,
    ]);
  });

  it('desmarcar un opcional respondido lo descarta al seguir; los demas quedan', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T12:00:00-03:00'));
    script = createScript([
      [OPTIONALS, ['Fecha', 'Período', 'Vencimiento']],
      [/Fecha del comprobante/, '01/10/2026'],
      [/Servicio desde/, '01/09/2026'],
      [/Servicio hasta/, '30/09/2026'],
      [/Vencimiento del pago/, BACK],
      [/Servicio hasta/, BACK],
      [/Servicio desde/, BACK],
      [/Fecha del comprobante/, BACK],
      [OPTIONALS, ['Período', 'Vencimiento']],
      [/Servicio desde/, '01/09/2026'],
      [/Servicio hasta/, '30/09/2026'],
      [/Vencimiento del pago/, '15/10/2026'],
    ]);

    const result = await askAdvancedOptions(PESOS, context('fa'));

    expect(result).toMatchObject({
      paymentDueDate: '15/10/2026',
      serviceEndDate: '30/09/2026',
      serviceStartDate: '01/09/2026',
    });
    expect(result).not.toHaveProperty('billingDate', '01/10/2026');
    // Al volver a la seleccion se ve lo respondido; el vencimiento quedo sin responder.
    expect(descriptions(1)).toMatchObject({
      'Fecha del comprobante': '01/10/2026',
      'Período del servicio': '01/09/2026 al 30/09/2026',
      'Vencimiento del pago': 'por defecto',
    });
    expect(script.askTextStep.mock.calls.slice(7).map((call) => call[1]?.previousAnswer)).toEqual([
      '01/09/2026',
      '30/09/2026',
      undefined,
    ]);
  });

  it('desmarcar todo y seguir no deja nada de lo respondido', async () => {
    script = createScript([
      [OPTIONALS, ['Moneda extranjera', 'Importe exento']],
      [/Moneda del comprobante/, 'Dólar'],
      [/Cómo te pagan/, 'En dólares'],
      [/exenta/, '100'],
      [/no gravada/, BACK],
      [/exenta/, BACK],
      [/Cómo te pagan/, BACK],
      [/Moneda del comprobante/, BACK],
      [OPTIONALS, []],
    ]);

    expect(await askAdvancedOptions(PESOS, context('fa'))).toEqual(PESOS);
    expect(descriptions(1)).toMatchObject({
      'Importe exento o no gravado': 'sin exento ni no gravado',
      'Moneda extranjera': 'dólares, cotización oficial de ARCA',
    });
  });

  it('si cambia la moneda se olvidan cómo te pagan y la cotización, pero no el exento', async () => {
    script = createScript([
      [OPTIONALS, ['Moneda extranjera', 'Importe exento']],
      [/Moneda del comprobante/, 'Dólar'],
      [/Cómo te pagan/, 'En pesos'],
      [/Cotización de USD/, '1.000'],
      [/exenta/, '50'],
      [/no gravada/, BACK],
      [/exenta/, BACK],
      [/Cotización de USD/, BACK],
      [/Cómo te pagan/, BACK],
      [/Moneda del comprobante/, 'Euro'],
      [/Cómo te pagan/, 'En pesos'],
      [/Cotización de EUR/, '1.200'],
      [/exenta/, '50'],
      [/no gravada/, ''],
    ]);

    expect(await askAdvancedOptions(PESOS, context('fa'))).toMatchObject({
      currencyCode: 'EUR',
      exchangeRate: 1200,
      exemptAmount: 50,
    });
    expect(script.chooseStep.mock.calls.map((call) => call[2])).toEqual(['PES', undefined, 'pesos', 'USD', undefined]);
    expect(script.askTextStep.mock.calls.map((call) => [call[0], call[1]?.previousAnswer])).toEqual([
      ['Cotización de USD:', undefined],
      [expect.stringMatching(/exenta/), undefined],
      [expect.stringMatching(/no gravada/), undefined],
      [expect.stringMatching(/exenta/), '50'],
      ['Cotización de USD:', '1000'],
      ['Cotización de EUR:', undefined],
      [expect.stringMatching(/exenta/), '50'],
      [expect.stringMatching(/no gravada/), undefined],
    ]);
  });

  // #8 de la auditoria del 19/11: sin fechas de servicio, el CLI usa la fecha del comprobante, no hoy.
  it('"Período del servicio" sin fechas describe la fecha del comprobante elegida', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T12:00:00-03:00'));
    script = createScript([
      [OPTIONALS, ['Fecha']],
      [/Fecha del comprobante/, '14/11/2026'],
      [OPTIONALS, ['Fecha']],
      [/Fecha del comprobante/, BACK],
      [OPTIONALS, []],
    ]);

    // Una segunda vuelta muestra lo elegido; la primera, sin fecha, "hoy".
    const first = await askAdvancedOptions(PESOS, context('fc'));

    await askAdvancedOptions(first as typeof PESOS, context('fc'));

    expect(descriptions(0)['Período del servicio']).toBe('hoy');
    expect(descriptions(1)['Período del servicio']).toBe('14/11/2026');
    expect(descriptions(2)['Período del servicio']).toBe('14/11/2026');
  });

  // TUI-18: lo que arranca escrito es la fecha resuelta, no la palabra; pegada otro dia sigue siendo esa fecha.
  it('volver despues de escribir `hoy` arranca con la fecha resuelta', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T12:00:00-03:00'));
    script = createScript([
      [OPTIONALS, ['Fecha', 'Vencimiento']],
      [/Fecha del comprobante/, 'hoy'],
      [/Vencimiento del pago/, BACK],
      [/Fecha del comprobante/, '-1'],
      [/Vencimiento del pago/, '+10'],
    ]);

    const answered = await askAdvancedOptions(PESOS, context('fc'));
    const dateCalls = script.askTextStep.mock.calls.filter(([message]) => /Fecha del comprobante/.test(message));

    expect(dateCalls[1]?.[1]?.previousAnswer).toBe('18/11/2026');
    expect(answered).toMatchObject({ billingDate: '17/11/2026', paymentDueDate: '28/11/2026' });
  });

  it('"Volver" en la seleccion vuelve al paso anterior', async () => {
    script = createScript([[OPTIONALS, BACK]]);

    expect(await askAdvancedOptions(PESOS, context('fc'))).toBe(BACK);
  });
});

describe('askAdvancedOptions: lo respondido se ve en la seleccion', () => {
  it('moneda con cotización acordada, exento y no gravado, período y vencimiento', async () => {
    script = createScript([
      [OPTIONALS, ['Moneda extranjera', 'Importe exento', 'Período', 'Vencimiento']],
      [/Moneda del comprobante/, 'Euro'],
      [/Cómo te pagan/, 'En pesos'],
      [/Cotización de EUR/, rejecting('1.600,5', ['1', /cotización acordada/], ['abc', /inválida/])],
      [/exenta/, '100'],
      [/no gravada/, '20,50'],
      [/Servicio desde/, '01/10/2026'],
      [/Servicio hasta/, '31/10/2026'],
      [/Vencimiento del pago/, '30/11/2026'],
    ]);

    const first = await askAdvancedOptions(PESOS, context('fa'));

    script = createScript([[OPTIONALS, []]]);
    await askAdvancedOptions(first as typeof PESOS, context('fa'));

    expect(first).toMatchObject({
      currencyCode: 'EUR',
      exchangeRate: 1600.5,
      exemptAmount: 100,
      sameCurrency: false,
      serviceEndDate: '31/10/2026',
      serviceStartDate: '01/10/2026',
      untaxedAmount: 20.5,
    });
    // Una segunda vuelta muestra lo elegido.
    expect(descriptions(0)).toMatchObject({
      'Importe exento o no gravado': 'exento 100, no gravado 20,50',
      'Moneda extranjera': 'euros, cotización 1.600,50',
      'Período del servicio': '01/10/2026 al 31/10/2026',
      'Vencimiento del pago': '30/11/2026',
    });
  });

  it('cobrado en la moneda usa la oficial; volver a pesos borra la cotización', async () => {
    script = createScript([
      [OPTIONALS, ['Moneda extranjera']],
      [/Moneda del comprobante/, 'Dólar'],
      [/Cómo te pagan/, 'En dólares'],
    ]);

    const inDollars = await askAdvancedOptions(PESOS, context('fb'));

    expect(inDollars).toMatchObject({ currencyCode: 'USD', exchangeRate: undefined, sameCurrency: true });

    script = createScript([
      [OPTIONALS, ['Moneda extranjera']],
      [/Moneda del comprobante/, 'Pesos'],
    ]);

    expect(await askAdvancedOptions({ ...PESOS, currencyCode: 'USD', exchangeRate: 1200 }, context('fb'))).toEqual({
      ...PESOS,
      currencyCode: 'ARS',
      exchangeRate: undefined,
    });
    // La lista arranca con la moneda que estaba elegida.
    expect(script.chooseStep.mock.calls[0]?.[2]).toBe('USD');
    expect(descriptions(0)['Moneda extranjera']).toBe('dólares, cotización 1.200');
  });

  it('una moneda que no esta en la tabla de ARCA se nombra por su código', async () => {
    script = createScript([[/Cómo te pagan/, 'En XYZ']]);

    expect(await askPaymentCurrency('XYZ')).toBe(true);
  });

  it('pasar a productos no deja las fechas de servicio ni el vencimiento ya cargados', async () => {
    script = createScript([[OPTIONALS, []]]);

    expect(
      await askAdvancedOptions(
        { ...PESOS, paymentDueDate: '30/11/2026', serviceEndDate: '31/10/2026', serviceStartDate: '01/10/2026' },
        context('fa', { concept: 'productos' }),
      ),
    ).toEqual({ ...PESOS, paymentDueDate: undefined, serviceEndDate: undefined, serviceStartDate: undefined });
    expect(Object.keys(descriptions(0))).not.toContain('Período del servicio');
  });

  it('en la C no hay alícuota ni exento: si venian cargados, no llegan', async () => {
    script = createScript([[OPTIONALS, []]]);

    expect(await askAdvancedOptions({ ...PESOS, exemptAmount: 10, untaxedAmount: 5 }, context('fc'))).toMatchObject({
      exemptAmount: undefined,
      untaxedAmount: undefined,
    });
    expect(Object.keys(descriptions(0))).toEqual([
      'Fecha del comprobante',
      'Moneda extranjera',
      'Período del servicio',
      'Vencimiento del pago',
    ]);
  });

  it('con la moneda fija (repetir en moneda extranjera) no la ofrece; la FCE ofrece la modalidad', async () => {
    script = createScript([
      [OPTIONALS, ['Modalidad', 'Alícuota']],
      [/Alícuota/, '10,5%'],
      [/Modalidad de transferencia/, 'ADC'],
      [OPTIONALS, []],
    ]);

    // Una segunda vuelta muestra lo elegido.
    const first = await askAdvancedOptions(
      PESOS,
      context('fcea', { currencyLock: { code: 'USD', reason: 'El monto es en USD.' } }),
    );

    await askAdvancedOptions(
      first as typeof PESOS,
      context('fcea', { currencyLock: { code: 'USD', reason: 'El monto es en USD.' } }),
    );

    expect(Object.keys(descriptions(0))).not.toContain('Moneda extranjera');
    expect(descriptions(1)).toMatchObject({ 'Alícuota de IVA': '10,5%', 'Modalidad de transferencia': 'ADC' });
    // La modalidad arranca en la elegida.
    expect(first).toMatchObject({ ivaRate: '10.5', transferMode: 'adc' });
  });

  it('las notas FCE no ofrecen vencimiento', async () => {
    script = createScript([[OPTIONALS, []]]);

    await askAdvancedOptions(PESOS, context('ncea'));

    expect(Object.keys(descriptions(0))).not.toContain('Vencimiento del pago');
  });
});

describe('initialAdvancedOptions', () => {
  it('arranca en pesos sin config, y en la moneda de la config con su cotización si no es 1', () => {
    expect(initialAdvancedOptions({})).toEqual({ currencyCode: 'ARS', sameCurrency: false });
    expect(initialAdvancedOptions({ monedaPorDefecto: 'DOL' })).toEqual({
      currencyCode: 'USD',
      exchangeRate: undefined,
      sameCurrency: false,
    });
    expect(initialAdvancedOptions({ cotizacionPorDefecto: 1200, monedaPorDefecto: 'USD' })).toMatchObject({
      exchangeRate: 1200,
    });
    expect(initialAdvancedOptions({ cotizacionPorDefecto: 1, monedaPorDefecto: 'USD' })).toMatchObject({
      exchangeRate: undefined,
    });
  });
});
