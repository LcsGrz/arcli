import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { billingAnswer, exportAnswer } from '../../../testing/arca-answers';
import { fakeBillingGateway, fakeExportGateway } from '../../../testing/arca-gateways';
import { arcliConfigSchema } from '../../config/config.schemas';
import { emitExport, previewExport } from '../../export/export.emission';
import type { ExportGateway } from '../../export/export.gateway';
import { EXPORT_VOUCHER_KIND } from '../../export/export.kinds';
import type { ExportVoucherPayload } from '../../export/export.types';
import { emitBilling, planBillingEmission } from '../billing.emission';
import { previewBilling } from '../billing.preview';
import { billingCommandSchema } from '../billing.schemas';
import type { BillingGateway } from '../billing.types.internal';
import type { VoucherRequest } from '../voucher-request';

/** ARQ-11 en el núcleo, como lo va a llamar cualquier adaptador: `shouldStop` y `onSending`, sin `process`. */

/** Lo nuevo de las opciones de `emitBilling` y `emitExport`. */
interface Interruption {
  readonly onSending?: () => void;
  readonly shouldStop?: () => boolean;
}

const runtime = { config: { verificarFce: false }, cuit: 20111111112, environment: 'testing' as const, pointOfSale: 3 };
const clock = { now: () => new Date('2026-11-18T15:00:00.000Z') };

/** Emite un lote de facturas C con un ARCA que anota en `calls`; las de `previews` quedan sin emitir. */
async function emitBatchOf(
  count: number,
  calls: string[],
  options: Interruption & { readonly failsAt?: 'emitir' | 'numero'; readonly previews?: readonly number[] } = {},
) {
  const { failsAt, previews = [], ...interruption } = options;
  const inputs = Array.from({ length: count }, (_, position) =>
    billingCommandSchema.parse({
      concept: 'servicios',
      documentType: 'consumidor-final',
      emit: !previews.includes(position + 1),
      ivaCondition: 'consumidor-final',
      shortcut: 'fc',
      totalAmount: 1000 * (position + 1),
    }),
  );
  const plan = {
    inputIndexes: inputs.map((_input, position) => position + 1),
    inputs,
    invalidItems: [],
    isBatch: true,
    total: count,
  };
  const items = await previewBilling({
    clock,
    gateways: {
      billing: { getQuotation: vi.fn() },
      fce: { getObligation: vi.fn() } as never,
      fceRegistry: { getVoucherState: vi.fn() },
      history: { getLastNumber: vi.fn(), getVoucher: vi.fn() },
      padron: { getTaxpayer: vi.fn() },
    },
    plan,
    runtime,
  });

  return emitBilling({
    clock,
    gateway: fakeBillingGateway({
      createVoucher: async ({ ImpTotal }) => {
        calls.push(`emitir ${ImpTotal}`);

        if (failsAt === 'emitir') {
          throw new Error('socket hang up');
        }

        return billingAnswer({
          cae: '75123456789012',
          caeFchVto: '20261130',
          response: { FeDetResp: { FECAEDetResponse: [{ CbteDesde: 42, CbteHasta: 42, Resultado: 'A' }] } },
        });
      },
      getNextVoucherNumber: async () => {
        calls.push('numero');

        if (failsAt === 'numero') {
          throw new Error('LoginFault');
        }

        return 42;
      },
    }),
    items: planBillingEmission(items),
    onEmitted: ({ payload }) => {
      calls.push(`emitido ${payload.ImpTotal}`);
    },
    runtime,
    scope: plan,
    ...interruption,
  });
}

async function emitExportInvoice(calls: string[], interruption: Interruption) {
  const exportRuntime = {
    config: arcliConfigSchema.parse({ cuit: '20111111112', puntoVentaPorDefecto: 3 }),
    cuit: 20111111112,
    environment: 'testing' as const,
  };
  const input = {
    amount: 1500,
    clientAddress: '123 Main St',
    clientName: 'ACME LLC',
    currencyCode: 'PES',
    destinationCountry: '212',
    emit: true,
    voucherKind: EXPORT_VOUCHER_KIND,
  };
  const gateway = fakeExportGateway({
    authorize: async (payload) => {
      calls.push(`emitir ${payload.Imp_total}`);

      return exportAnswer({
        FEXAuthorizeResult: {
          FEXErr: { ErrCode: 0, ErrMsg: '' },
          FEXEvents: { EventCode: 0, EventMsg: '' },
          FEXResultAuth: { Cae: '75123456789012', Cbte_nro: 1, Fch_venc_Cae: '20261130', Id: 8, Resultado: 'A' },
        },
      });
    },
  });
  const { resolved, warnings } = await previewExport({ clock, gateway, input, runtime: exportRuntime });

  return emitExport({ clock, gateway, input, resolved, runtime: exportRuntime, warnings, ...interruption });
}

describe('shouldStop', () => {
  // Tests primero (ARQ-11): pasa a it() al implementarlo.
  it.fails('entre comprobantes: el siguiente ni pide su número, y lo emitido vuelve con el error', async () => {
    const calls: string[] = [];
    const outcome = await emitBatchOf(3, calls, { shouldStop: () => calls.includes('emitido 1000') });

    expect(calls).toEqual(['numero', 'emitir 1000', 'emitido 1000']);
    expect(outcome).toMatchObject({
      error: {
        code: 'BATCH_EMISSION_ERROR',
        details: { codigoCausa: 'CANCELLED', procesados: 1, sinProcesar: [2, 3], total: 3 },
      },
      results: [{ response: { cae: '75123456789012' } }],
    });
  });

  it('con el último ya contestado, no hay nada que cortar', async () => {
    const calls: string[] = [];
    const outcome = await emitBatchOf(2, calls, { shouldStop: () => calls.includes('emitido 2000') });

    expect(outcome.results).toHaveLength(2);
    expect('error' in outcome).toBe(false);
  });

  it('si da falso, emite todo', async () => {
    const calls: string[] = [];
    const outcome = await emitBatchOf(2, calls, { shouldStop: () => false });

    expect(outcome.results).toHaveLength(2);
    expect('error' in outcome).toBe(false);
  });
});

describe('onSending', () => {
  // Tests primero (ARQ-11): pasa a it() al implementarlo.
  it.fails('justo antes de la llamada que emite, una vez por comprobante que se emite', async () => {
    const calls: string[] = [];

    await emitBatchOf(3, calls, { onSending: () => calls.push('se envía'), previews: [2] });

    expect(calls).toEqual([
      ...['numero', 'se envía', 'emitir 1000', 'emitido 1000'],
      ...['numero', 'se envía', 'emitir 3000', 'emitido 3000'],
    ]);
  });

  // Tests primero (ARQ-11): pasa a it() al implementarlo.
  it.fails('si la llamada que emite falla, se avisó y no se reintenta', async () => {
    const calls: string[] = [];

    await emitBatchOf(2, calls, { failsAt: 'emitir', onSending: () => calls.push('se envía') });

    expect(calls).toEqual(['numero', 'se envía', 'emitir 1000']);
  });

  it('si falla el número no se envía nada: no avisa', async () => {
    const onSending = vi.fn();

    await emitBatchOf(1, [], { failsAt: 'numero', onSending });

    expect(onSending).not.toHaveBeenCalled();
  });

  // Tests primero (ARQ-11): pasa a it() al implementarlo.
  it.fails('en la E, justo antes de `authorize`', async () => {
    const calls: string[] = [];

    await emitExportInvoice(calls, { onSending: () => calls.push('se envía') });

    expect(calls).toEqual(['se envía', 'emitir 1500']);
  });
});

it('por tipo, las llamadas que emiten no aceptan una señal con que cancelarlas', () => {
  expectTypeOf<Parameters<BillingGateway['createVoucher']>>().toEqualTypeOf<[voucher: VoucherRequest]>();
  expectTypeOf<Parameters<ExportGateway['authorize']>>().toEqualTypeOf<[payload: ExportVoucherPayload]>();
});
