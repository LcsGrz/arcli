import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import type { IssuedVoucher } from '../../vouchers/voucher-history';
import { assertCreditNoteWithinAssociated, checkAssociatedInArca } from '../billing.associated-lookup';
import type { BillingCommandInput } from '../billing.schemas';
import { BillingService } from '../billing.service';

const EMITTER = 20123456786;

const runtime = {
  certificateNotices: [],
  config: { puntoVentaPorDefecto: 3 },
  context: { cuit: EMITTER },
  environment: 'testing',
  outputJson: false,
  outputRaw: false,
  pointOfSale: 3,
} as unknown as ResolvedArcaRuntime;

function note(overrides: Partial<BillingCommandInput> = {}): BillingCommandInput {
  return {
    associatedVoucher: { cuit: String(EMITTER), numero: 12, puntoVenta: 3, shortcut: 'fc' },
    billingDate: '18/03/2026',
    cancellation: false,
    concept: 'servicios',
    currencyCode: 'PES',
    documentType: 'consumidor-final',
    dryRun: false,
    emit: true,
    exchangeRate: 1,
    ivaCondition: 'consumidor-final',
    sameCurrency: false,
    shortcut: 'ncc',
    totalAmount: 1000,
    ...overrides,
  };
}

const fceNote = (overrides: Partial<BillingCommandInput> = {}) =>
  note({
    associatedVoucher: { numero: 7, puntoVenta: 3, shortcut: 'fcea' },
    documentNumber: 30709965812,
    documentType: 'cuit',
    ivaCondition: 'responsable-inscripto',
    shortcut: 'ncea',
    ...overrides,
  });

function issued(overrides: Partial<IssuedVoucher> = {}): IssuedVoucher {
  return {
    currency: 'PES',
    date: '20260310',
    documentNumber: 0,
    documentTypeCode: 99,
    ivaAmount: 0,
    netAmount: 800,
    number: 12,
    result: 'A',
    total: 800,
    ...overrides,
  };
}

function check(input: BillingCommandInput, voucher: IssuedVoucher | undefined) {
  const gateway = { getVoucher: vi.fn(async () => voucher) };
  const result = checkAssociatedInArca({ gateway, input, runtime, service: new BillingService() });

  return { gateway, result };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-18T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('assertCreditNoteWithinAssociated', () => {
  it('acepta una NC igual al total del asociado', () => {
    expect(() =>
      assertCreditNoteWithinAssociated({
        associated: { currency: 'PES', total: 1000 },
        associatedLabel: 'la factura C 00003-00000012',
        note: { currencyCode: 'PES', total: 1000 },
      }),
    ).not.toThrow();
  });

  it('en otra moneda no compara los totales, como en la E', () => {
    expect(() =>
      assertCreditNoteWithinAssociated({
        associated: { currency: 'DOL', total: 10 },
        associatedLabel: 'la factura C 00003-00000012',
        note: { currencyCode: 'PES', total: 1000 },
      }),
    ).not.toThrow();
  });
});

describe('checkAssociatedInArca: NC no mayor que el asociado (REV-45)', () => {
  it('una NC C mayor que su factura es un error de validacion', async () => {
    const { gateway, result } = check(note(), issued());

    await expect(result).rejects.toMatchObject({
      code: 'INPUT_VALIDATION_ERROR',
      message: expect.stringContaining('no puede superar el total de la factura C 00003-00000012'),
    });
    expect(gateway.getVoucher).toHaveBeenCalledWith(12, 3, 11);
  });

  it('una NC dentro del total pasa sin cambios', async () => {
    const input = note({ totalAmount: 800 });

    await expect(check(input, issued()).result).resolves.toBe(input);
  });

  it('una NC FCE con --afecha igual controla el tope y conserva la fecha', async () => {
    const input = fceNote({ associatedVoucher: { fecha: '05/03/2026', numero: 7, puntoVenta: 3, shortcut: 'fcea' } });

    await expect(check(input, issued({ total: 5000 })).result).resolves.toBe(input);
    await expect(check(input, issued({ total: 500 })).result).rejects.toThrow(/no puede superar/);
  });

  it('si ARCA no tiene el asociado de una NC comun, decide ARCA al emitir', async () => {
    const input = note();

    await expect(check(input, undefined).result).resolves.toBe(input);
  });

  it('no consulta el asociado de otro CUIT ni el de una ND comun', async () => {
    const otherCuit = check(
      note({ associatedVoucher: { cuit: '20999999999', numero: 12, puntoVenta: 3, shortcut: 'fc' } }),
      issued(),
    );
    const debit = check(note({ shortcut: 'ndc' }), issued());

    await otherCuit.result;
    await debit.result;
    expect(otherCuit.gateway.getVoucher).not.toHaveBeenCalled();
    expect(debit.gateway.getVoucher).not.toHaveBeenCalled();
  });

  it('una entrada invalida falla antes de consultar ARCA', async () => {
    const { gateway, result } = check(note({ ivaRate: '21' }), issued());

    await expect(result).rejects.toThrow(/no discrimina IVA/);
    expect(gateway.getVoucher).not.toHaveBeenCalled();
  });
});

describe('checkAssociatedInArca: fecha del asociado en notas FCE (REV-46)', () => {
  it('sin --afecha toma la fecha del asociado en ARCA', async () => {
    const { gateway, result } = check(fceNote({ shortcut: 'ndea' }), issued({ date: '20260310' }));
    const input = await result;

    expect(gateway.getVoucher).toHaveBeenCalledWith(7, 3, 201);
    expect(input.associatedVoucher?.fecha).toBe('10/03/2026');
    expect(new BillingService().buildVoucherPayload(input, runtime).CbtesAsoc).toEqual([
      { CbteFch: '20260310', Cuit: String(EMITTER), Nro: 7, PtoVta: 3, Tipo: 201 },
    ]);
  });

  it('con --afecha no consulta una ND FCE', async () => {
    const { gateway } = check(
      fceNote({
        associatedVoucher: { fecha: '05/03/2026', numero: 7, puntoVenta: 3, shortcut: 'fcea' },
        shortcut: 'ndea',
      }),
      issued(),
    );

    expect(gateway.getVoucher).not.toHaveBeenCalled();
  });

  it('si ARCA no tiene el asociado, frena: sin fecha la nota FCE no se puede emitir', async () => {
    await expect(check(fceNote(), undefined).result).rejects.toMatchObject({
      code: 'INPUT_VALIDATION_ERROR',
      message: expect.stringContaining('ARCA no tiene la factura de crédito electrónica A 00003-00000007'),
    });
  });

  it('una fecha de ARCA posterior a la nota sigue siendo un error', async () => {
    const input = await check(fceNote(), issued({ date: '20260320', total: 5000 })).result;

    expect(() => new BillingService().buildVoucherPayload(input, runtime)).toThrow(/no puede ser posterior/);
  });
});
