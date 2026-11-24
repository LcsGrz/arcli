import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { AppError } from '../../../lib/errors/app-error';
import { exportAnswer } from '../../../testing/arca-answers';
import { fakeExportGateway } from '../../../testing/arca-gateways';
import { EmissionUncertainError } from '../../billing/billing.errors';
import { arcliConfigSchema } from '../../config/config.schemas';
import { emitExport, previewExport } from '../export.emission';
import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_DEBIT_NOTE_KIND,
  EXPORT_VOUCHER_KIND,
  type ExportGateway,
  type ExportIssuedVoucher,
  type ExportPreviewGateway,
  type ExportVoucherInput,
} from '../export.types';

/** Los casos de uso de la E sin el CLI (REV-50): como los va a llamar otro adaptador. */

const clock = { now: () => new Date('2026-11-18T15:00:00.000Z') };
const runtime = {
  config: arcliConfigSchema.parse({ cuit: '20111111112', puntoVentaPorDefecto: 3 }),
  cuit: 20111111112,
  environment: 'testing' as const,
};

const INVOICE: ExportVoucherInput = {
  amount: 1500,
  clientAddress: '123 Main St',
  clientName: 'ACME LLC',
  currencyCode: 'PES',
  destinationCountry: '212',
  emit: true,
  voucherKind: EXPORT_VOUCHER_KIND,
};

const ISSUED: ExportIssuedVoucher = {
  activities: [],
  arcaType: 19,
  clientAddress: '123 Main St',
  clientCountryCuit: 55000002126,
  clientName: 'ACME LLC',
  currencyCode: 'PES',
  date: '20261030',
  destinationCountry: 212,
  exchangeRate: 1,
  exportType: 2,
  language: 1,
  number: 1,
  pointOfSale: 3,
  result: 'A',
  total: 1500,
};

const NOTE = { amount: 500, associatedVoucher: { number: 1 }, emit: true };

const FAMILIES: ReadonlyArray<readonly [string, ExportVoucherInput]> = [
  ['fe', INVOICE],
  ['nce', { ...NOTE, voucherKind: EXPORT_CREDIT_NOTE_KIND }],
  ['nde', { ...NOTE, voucherKind: EXPORT_DEBIT_NOTE_KIND }],
];

function gatewayWith(result: 'A' | 'R', overrides: Partial<ExportGateway> = {}): ExportGateway {
  return fakeExportGateway({
    authorize: vi.fn(async (payload) =>
      exportAnswer({
        FEXAuthorizeResult: {
          FEXErr: result === 'R' ? { ErrCode: 1500, ErrMsg: 'fecha' } : { ErrCode: 0, ErrMsg: '' },
          FEXEvents: { EventCode: 0, EventMsg: '' },
          FEXResultAuth: {
            Cae: result === 'A' ? '75123456789012' : '',
            Cbte_nro: payload.Cbte_nro,
            Cbte_tipo: payload.Cbte_Tipo,
            Cuit: 20111111112,
            Fch_cbte: payload.Fecha_cbte,
            Fch_venc_Cae: '20261130',
            Id: payload.Id,
            Motivos_Obs: '',
            Punto_vta: payload.Punto_vta,
            Reproceso: 'N',
            Resultado: result,
          },
        },
      }),
    ),
    getVoucher: vi.fn(async () => ISSUED),
    ...overrides,
  });
}

/** El gateway de la vista previa, de verdad sin la llamada que emite. */
function readsOnly({ authorize: _authorize, ...reads }: ExportGateway): ExportPreviewGateway {
  return reads;
}

const preview = (input: ExportVoucherInput, extraWarnings?: readonly string[]) =>
  previewExport({ clock, extraWarnings, gateway: readsOnly(gatewayWith('A')), input, runtime });

describe('previewExport', () => {
  it('por tipo, su gateway no emite', () => {
    expectTypeOf<ExportPreviewGateway>().not.toHaveProperty('authorize');
  });

  it.each(FAMILIES)('%s: resuelve y arma la vista previa, aunque la entrada pida emitir', async (_name, input) => {
    const result = await preview(input);

    expect(result.preview).toMatchObject({ dryRun: true, payload: { Cbte_Tipo: input.voucherKind?.arcaType } });
    expect(result.preview.payload).toBe(result.resolved.payload);
  });

  it('los avisos de quien llama van antes que los de la resolución', async () => {
    const { preview: result, warnings } = await preview({ ...INVOICE, voucherDate: '20/11/2026' }, ['certificado']);

    expect(warnings).toEqual(['certificado', expect.stringContaining('1535')]);
    expect(result.warnings).toEqual(warnings);
  });

  it('sin avisos de quien llama ni de la resolución, no hay ninguno', async () => {
    expect((await preview(INVOICE)).warnings).toEqual([]);
  });

  it('un error de la entrada sale tal cual', async () => {
    await expect(preview({ ...INVOICE, amount: 0 })).rejects.toMatchObject({ code: 'INPUT_VALIDATION_ERROR' });
  });
});

describe('emitExport', () => {
  it.each(FAMILIES)('%s: emite lo resuelto, sin volver a consultar, y avisa', async (_name, input) => {
    const { resolved } = await preview(input);
    const gateway = gatewayWith('A');
    const onEmitted = vi.fn();
    const outcome = await emitExport({ clock, gateway, input, onEmitted, resolved, runtime, warnings: ['aviso'] });

    expect(gateway.authorize).toHaveBeenCalledExactlyOnceWith(resolved.payload);
    expect(gateway.getLastVoucherNumber).not.toHaveBeenCalled();
    expect(outcome).toEqual({ results: [expect.objectContaining({ dryRun: false, warnings: ['aviso'] })] });
    expect(onEmitted).toHaveBeenCalledExactlyOnceWith(outcome.results[0], 0);
  });

  it('con el día del reloj que se pasa', async () => {
    const { resolved } = await previewExport({
      clock: { now: () => new Date('2026-12-03T15:00:00.000Z') },
      gateway: readsOnly(gatewayWith('A')),
      input: INVOICE,
      runtime,
    });

    expect(resolved.payload.Fecha_cbte).toBe('20261203');
  });

  it('una entrada que no pide emitir: error interno, sin llamar a ARCA', async () => {
    const { resolved, warnings } = await preview(INVOICE);
    const gateway = gatewayWith('A');
    const outcome = await emitExport({
      clock,
      gateway,
      input: { ...INVOICE, emit: false },
      resolved,
      runtime,
      warnings,
    });

    expect(outcome).toEqual({ error: expect.any(Error), results: [] });
    expect('error' in outcome && outcome.error).not.toBeInstanceOf(AppError);
    expect(gateway.authorize).not.toHaveBeenCalled();
  });

  it('un rechazo es un resultado, no un error', async () => {
    const { resolved, warnings } = await preview(INVOICE);
    const outcome = await emitExport({ clock, gateway: gatewayWith('R'), input: INVOICE, resolved, runtime, warnings });

    expect(outcome).toEqual({
      results: [expect.objectContaining({ response: expect.objectContaining({ status: 'rechazado' }) })],
    });
  });

  it('si falla la llamada que emite, el error vuelve como dato y no se avisa', async () => {
    const { resolved, warnings } = await preview(INVOICE);
    const onEmitted = vi.fn();
    const outcome = await emitExport({
      clock,
      gateway: gatewayWith('A', { authorize: () => Promise.reject(new Error('socket hang up')) }),
      input: INVOICE,
      onEmitted,
      resolved,
      runtime,
      warnings,
    });

    expect(outcome).toEqual({ error: expect.any(EmissionUncertainError), results: [] });
    expect(onEmitted).not.toHaveBeenCalled();
  });

  it('si el aviso falla, lo emitido no se ve como un error', async () => {
    const { resolved, warnings } = await preview(INVOICE);
    const outcome = await emitExport({
      clock,
      gateway: gatewayWith('A'),
      input: INVOICE,
      onEmitted: () => {
        throw new Error('disco lleno');
      },
      resolved,
      runtime,
      warnings,
    });

    expect(outcome).not.toHaveProperty('error');
    expect(outcome.results).toHaveLength(1);
  });
});
