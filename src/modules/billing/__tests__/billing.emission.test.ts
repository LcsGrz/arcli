import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { InputValidationError } from '../../../lib/errors/app-error';
import { billingAnswer } from '../../../testing/arca-answers';
import { fakeBillingGateway } from '../../../testing/arca-gateways';
import { BatchEmissionError, BatchValidationError } from '../billing.batch';
import type { BatchPlan } from '../billing.batch-run';
import { type BillingEmissionItem, emitBilling, planBillingEmission } from '../billing.emission';
import { EmissionUncertainError } from '../billing.errors';
import { type BillingPreviewGateways, previewBilling, type PreviewBillingOptions } from '../billing.preview';
import { type BillingCommandInput, billingCommandSchema } from '../billing.schemas';
import type { BillingExecutionResult, BillingGateway } from '../billing.types.internal';

/** Los casos de uso de A, B, C y FCE sin el CLI (REV-50): como los va a llamar otro adaptador. */

const CLIENT_CUIT = 30709965812;
const runtime = {
  config: { verificarFce: true },
  cuit: 20111111112,
  environment: 'testing' as const,
  pointOfSale: 3,
};
const clockAt = (date: string) => ({ now: () => new Date(`${date}T15:00:00.000Z`) });
const clock = clockAt('2026-11-18');

function input(overrides: Partial<BillingCommandInput> = {}): BillingCommandInput {
  return billingCommandSchema.parse({
    concept: 'servicios',
    documentType: 'consumidor-final',
    ivaCondition: 'consumidor-final',
    shortcut: 'fc',
    totalAmount: 1000,
    ...overrides,
  });
}

const toEmit = (overrides: Partial<BillingCommandInput> = {}) => input({ emit: true, ...overrides });

function planOf(
  inputs: readonly BillingCommandInput[],
  overrides: Partial<BatchPlan> = {},
): PreviewBillingOptions['plan'] {
  return {
    inputIndexes: inputs.map((_input, position) => position + 1),
    inputs,
    invalidItems: [],
    isBatch: inputs.length > 1,
    total: inputs.length,
    ...overrides,
  };
}

/** Sin `createVoucher` ni `getNextVoucherNumber`: no hace falta un gateway que tire error. */
function previewGateways(calls: string[] = []): BillingPreviewGateways {
  const call = <T>(name: string, value: T) =>
    vi.fn(async () => {
      calls.push(name);

      return value;
    });

  return {
    billing: { getQuotation: call('getQuotation', 1000) },
    fce: { getObligation: call('getObligation', { minimumAmount: 1, obligated: true }) } as never,
    fceRegistry: { getVoucherState: call('getVoucherState', 'Aceptado' as const) },
    history: {
      getLastNumber: call('getLastNumber', 12),
      getVoucher: call('getVoucher', {
        currency: 'PES',
        date: '20261105',
        documentNumber: CLIENT_CUIT,
        documentTypeCode: 80,
        ivaAmount: 0,
        netAmount: 5_000_000,
        number: 12,
        result: 'A',
        total: 5_000_000,
      }),
    },
    padron: { getTaxpayer: call('getTaxpayer', null) },
  };
}

const preview = (plan: PreviewBillingOptions['plan'], overrides: Partial<PreviewBillingOptions> = {}) =>
  previewBilling({ clock, gateways: previewGateways(), plan, runtime, ...overrides });

const approved = () =>
  billingAnswer({
    cae: '75123456789012',
    caeFchVto: '20261130',
    response: { FeDetResp: { FECAEDetResponse: [{ CbteDesde: 42, CbteHasta: 42, Resultado: 'A' }] } },
  });

const rejected = () =>
  billingAnswer({
    cae: '',
    caeFchVto: '',
    response: {
      Errors: { Err: [{ Code: 10016, Msg: 'numero' }] },
      FeDetResp: { FECAEDetResponse: [{ Resultado: 'R' }] },
    },
  });

/** Un ARCA que anota en `calls` y falla al emitir la posicion que se pide. */
function emitter(calls: string[], failure?: { readonly at: number; readonly step: 'emitir' | 'numero' }) {
  let position = 0;

  return fakeBillingGateway({
    createVoucher: vi.fn(async ({ ImpTotal }) => {
      calls.push(`emitir ${ImpTotal}`);

      if (failure?.step === 'emitir' && failure.at === position) {
        throw new Error('socket hang up');
      }

      position += 1;

      return approved();
    }),
    getNextVoucherNumber: vi.fn(async () => {
      calls.push('numero');

      if (failure?.step === 'numero' && failure.at === position) {
        throw new Error('LoginFault');
      }

      return 42 + position;
    }),
  });
}

async function emit(
  inputs: readonly BillingCommandInput[],
  options: {
    readonly confirmed?: boolean;
    readonly gateway: BillingGateway;
    readonly onEmitted?: (result: BillingExecutionResult) => void;
    readonly plan?: Partial<BatchPlan>;
  },
) {
  const plan = planOf(inputs, options.plan);
  const previewed = await preview(plan, { runtime: { ...runtime, config: { verificarFce: false } } });
  const items = planBillingEmission({ ...previewed, confirmed: options.confirmed ? previewed.previews : undefined });

  return emitBilling({ clock, gateway: options.gateway, items, onEmitted: options.onEmitted, plan, runtime });
}

describe('previewBilling', () => {
  it('por tipo, sus gateways no emiten ni piden el número', () => {
    expectTypeOf<BillingPreviewGateways['billing']>().not.toHaveProperty('createVoucher');
    expectTypeOf<BillingPreviewGateways['billing']>().not.toHaveProperty('getNextVoucherNumber');
  });

  it('completa la entrada, arma la vista previa y deja los avisos en orden: los de afuera, la entrada y el régimen FCE', async () => {
    const calls: string[] = [];
    const entry = input({
      currencyCode: 'USD',
      documentNumber: CLIENT_CUIT,
      documentType: 'cuit',
      emit: true,
      exchangeRate: undefined,
      ivaCondition: 'responsable-inscripto',
      shortcut: 'fa',
      totalAmount: 5_000_000,
    });
    const result = await preview(planOf([entry]), {
      extraWarnings: ['el certificado vence'],
      gateways: previewGateways(calls),
    });

    expect(calls).toEqual(['getQuotation', 'getObligation']);
    expect(result.inputs).toEqual([expect.objectContaining({ exchangeRate: 1000, exchangeRateSource: 'arca' })]);
    expect(result.warnings).toEqual([
      ['el certificado vence', expect.stringContaining('cotización oficial'), expect.stringContaining('FCE')],
    ]);
    // Aunque la entrada pida emitir, es una vista previa.
    expect(result.previews).toEqual([
      expect.objectContaining({
        dryRun: true,
        payload: expect.objectContaining({ CbteFch: '20261118', MonCotiz: 1000 }),
        warnings: result.warnings[0],
      }),
    ]);
  });

  it('una nota FCE de anulación consulta el asociado, completa su fecha y avisa el estado', async () => {
    const calls: string[] = [];
    const { inputs, previews, warnings } = await preview(
      planOf([
        input({
          associatedVoucher: { numero: 12, puntoVenta: 3, shortcut: 'fcea' },
          cancellation: true,
          documentNumber: CLIENT_CUIT,
          documentType: 'cuit',
          ivaCondition: 'responsable-inscripto',
          shortcut: 'ncea',
        }),
      ]),
      { gateways: previewGateways(calls) },
    );

    expect(calls).toEqual(['getVoucher', 'getVoucherState']);
    expect(previews[0]?.payload.CbtesAsoc).toEqual([expect.objectContaining({ CbteFch: '20261105' })]);
    expect(inputs[0]?.associatedVoucher).toMatchObject({ fecha: expect.any(String) });
    expect(warnings[0]).toEqual([expect.stringContaining('10154')]);
  });

  it('en un lote junta los que no se leyeron y los que no valen, con su índice, y no consulta el régimen FCE', async () => {
    const calls: string[] = [];
    const plan = planOf([toEmit(), toEmit({ billingDate: '01/01/2026' })], {
      inputIndexes: [1, 3],
      invalidItems: [{ code: 'INPUT_VALIDATION_ERROR', index: 2, message: 'Falta monto.', suggestion: null }],
      total: 3,
    });
    const error = await preview(plan, { gateways: previewGateways(calls) }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(BatchValidationError);
    expect((error as BatchValidationError).details.comprobantes.map(({ indice }) => indice)).toEqual([2, 3]);
    expect(calls).toEqual([]);
  });

  it('uno suelto falla con su propio error', async () => {
    await expect(preview(planOf([input({ billingDate: '01/01/2026' })]))).rejects.toBeInstanceOf(InputValidationError);
  });
});

describe('planBillingEmission', () => {
  it.each([
    { dryRun: false, emit: false },
    { dryRun: true, emit: true },
    { dryRun: true, emit: false },
  ])('dryRun $dryRun y emit $emit: queda la vista previa, sin la entrada con que emitirla', async (mode) => {
    const previewed = await preview(planOf([input()]));
    const items = planBillingEmission({ ...previewed, inputs: [{ ...input(), ...mode }] });

    expect(items).toEqual([{ kind: 'preview', result: previewed.previews[0] }]);
  });

  it('lo que se emite lleva sus avisos, y la vista previa solo si se confirmó', async () => {
    const previewed = await preview(planOf([toEmit()]), { extraWarnings: ['aviso'] });
    const base = { input: previewed.inputs[0], kind: 'emission', warnings: ['aviso'] };

    expect(planBillingEmission(previewed)).toEqual([{ ...base, preview: undefined }]);
    expect(planBillingEmission({ ...previewed, confirmed: previewed.previews })).toEqual([
      { ...base, preview: previewed.previews[0] },
    ]);
  });
});

describe('emitBilling', () => {
  it('emite de a uno y en orden, y avisa cada uno antes de seguir con el próximo', async () => {
    const calls: string[] = [];
    const outcome = await emit([toEmit(), toEmit({ totalAmount: 2000 })], {
      gateway: emitter(calls),
      onEmitted: ({ voucherNumber }) => calls.push(`avisado ${voucherNumber}`),
    });

    expect(calls).toEqual(['numero', 'emitir 1000', 'avisado 42', 'numero', 'emitir 2000', 'avisado 43']);
    expect(outcome).toEqual({
      results: [expect.objectContaining({ voucherNumber: 42 }), expect.objectContaining({ voucherNumber: 43 })],
    });
  });

  it('lo confirmado sale con el payload de la vista previa; sin confirmar, se arma con el día de la emisión', async () => {
    const previewed = await preview(planOf([toEmit()]));
    const sent: string[] = [];

    for (const confirmed of [previewed.previews, undefined]) {
      await emitBilling({
        clock: clockAt('2026-11-19'),
        gateway: fakeBillingGateway({
          createVoucher: async ({ CbteFch }) => {
            sent.push(CbteFch);

            return approved();
          },
        }),
        items: planBillingEmission({ ...previewed, confirmed }),
        plan: planOf([]),
        runtime,
      });
    }

    expect(sent).toEqual(['20261118', '20261119']);
  });

  it('en un lote mixto, lo que queda en vista previa ocupa su lugar y no se avisa', async () => {
    const onEmitted = vi.fn();
    const calls: string[] = [];
    const { results } = await emit([toEmit(), input(), toEmit({ totalAmount: 3000 })], {
      gateway: emitter(calls),
      onEmitted,
    });

    expect(results.map(({ dryRun }) => dryRun)).toEqual([false, true, false]);
    expect(calls).toEqual(['numero', 'emitir 1000', 'numero', 'emitir 3000']);
    expect(onEmitted).toHaveBeenCalledTimes(2);
  });

  it('un rechazo también se avisa y no corta', async () => {
    const onEmitted = vi.fn();
    const outcome = await emit([toEmit(), toEmit()], {
      gateway: fakeBillingGateway({ createVoucher: async () => rejected() }),
      onEmitted,
    });

    expect(outcome).not.toHaveProperty('error');
    expect(onEmitted.mock.calls.map(([result]) => result.response.status)).toEqual(['rechazado', 'rechazado']);
  });

  it.each([
    ['numero', { fallo: 3, procesados: 2, sinProcesar: [3, 4] }],
    ['emitir', { fallo: 3, procesados: 2, sinConfirmar: 3, sinProcesar: [4] }],
  ] as const)(
    'un lote cortado al pedir %s: devuelve lo procesado, con la vista previa, y el error; no sigue',
    async (step, details) => {
      const calls: string[] = [];
      const outcome = await emit([toEmit(), input(), toEmit(), toEmit()], {
        gateway: emitter(calls, { at: 1, step }),
      });

      expect(outcome.results.map(({ dryRun }) => dryRun)).toEqual([false, true]);
      expect('error' in outcome && outcome.error).toBeInstanceOf(BatchEmissionError);
      expect('error' in outcome && outcome.error).toMatchObject({ details: { ...details, total: 4 } });
      expect(calls.filter((call) => call === 'numero')).toHaveLength(2);
    },
  );

  it('uno suelto: el error es el suyo, sin confirmar si falló la llamada que emite', async () => {
    const uncertain = await emit([toEmit()], { gateway: emitter([], { at: 0, step: 'emitir' }) });
    const before = await emit([toEmit()], { gateway: emitter([], { at: 0, step: 'numero' }) });

    expect(uncertain).toEqual({ error: expect.any(EmissionUncertainError), results: [] });
    expect(before).toEqual({ error: new Error('LoginFault'), results: [] });
  });

  it('si el aviso falla, lo emitido no se ve como un error y el lote sigue', async () => {
    const outcome = await emit([toEmit(), toEmit()], {
      gateway: emitter([]),
      onEmitted: () => {
        throw new Error('disco lleno');
      },
    });

    expect(outcome).not.toHaveProperty('error');
    expect(outcome.results.map(({ voucherNumber }) => voucherNumber)).toEqual([42, 43]);
  });

  it('por tipo, una vista previa no trae con qué emitirla', () => {
    expectTypeOf<Extract<BillingEmissionItem, { kind: 'preview' }>>().not.toHaveProperty('input');
  });
});
