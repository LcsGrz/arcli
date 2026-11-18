import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import type { FceRegistryState } from '../../fce/fce-registry';
import type { IssuedVoucher } from '../../vouchers/voucher-history';
import {
  assertCreditNoteWithinAssociated,
  checkAssociatedInArca,
  checkFceCancellationInRegistry,
} from '../billing.associated-lookup';
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

function check(input: BillingCommandInput, voucher: IssuedVoucher | undefined | Error) {
  const gateway = {
    getVoucher: vi.fn(async () => {
      if (voucher instanceof Error) {
        throw voucher;
      }

      return voucher;
    }),
  };
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
  it('una NC C mayor que su factura es un error de validacion, con la sugerencia de anularla entera', async () => {
    const { gateway, result } = check(note(), issued({ total: 800.5 }));

    await expect(result).rejects.toMatchObject({
      code: 'INPUT_VALIDATION_ERROR',
      message: 'La nota de crédito por $ 1.000 no puede superar el total de la factura C 00003-00000012, de $ 800,50.',
      suggestion: 'Para anularla entera usá `--monto 800,50`.',
    });
    expect(gateway.getVoucher).toHaveBeenCalledWith(12, 3, 11);
  });

  it('con una ND como asociado compara contra el total de la ND y la nombra en el error', async () => {
    const input = note({ associatedVoucher: { cuit: String(EMITTER), numero: 5, puntoVenta: 3, shortcut: 'ndc' } });
    const { gateway, result } = check(input, issued({ number: 5, total: 300 }));

    await expect(result).rejects.toMatchObject({
      message:
        'La nota de crédito por $ 1.000 no puede superar el total de la nota de débito C 00003-00000005, de $ 300.',
    });
    expect(gateway.getVoucher).toHaveBeenCalledWith(5, 3, 12);
  });

  it('una NC sobre otra NC no tiene tope, como en la E, pero se consulta para ver que exista (2.5.1)', async () => {
    const input = note({ associatedVoucher: { cuit: String(EMITTER), numero: 5, puntoVenta: 3, shortcut: 'ncc' } });
    const { gateway, result } = check(input, issued({ number: 5, total: 300 }));

    await expect(result).resolves.toEqual({ input, warnings: [] });
    expect(gateway.getVoucher).toHaveBeenCalledTimes(1);
  });

  it('una NC dentro del total pasa sin cambios', async () => {
    const input = note({ totalAmount: 800 });

    await expect(check(input, issued()).result).resolves.toEqual({ input, warnings: [] });
  });

  it('una NC FCE con --afecha igual controla el tope y conserva la fecha', async () => {
    const input = fceNote({ associatedVoucher: { fecha: '05/03/2026', numero: 7, puntoVenta: 3, shortcut: 'fcea' } });

    await expect(check(input, issued({ total: 5000 })).result).resolves.toEqual({ input, warnings: [] });
    await expect(check(input, issued({ total: 500 })).result).rejects.toThrow(/no puede superar/);
  });

  it('si ARCA no tiene el asociado propio de una NC comun, es un error de validacion como en la E', async () => {
    await expect(check(note(), undefined).result).rejects.toMatchObject({
      code: 'INPUT_VALIDATION_ERROR',
      message: 'ARCA no tiene la factura C 00003-00000012.',
      suggestion: 'Revisá `--ar`, `--apv` y `--ac`: el asociado tiene que ser un comprobante tuyo ya emitido.',
    });
  });

  it('si ARCA no tiene el asociado propio de una ND comun, tambien frena', async () => {
    await expect(check(note({ shortcut: 'ndc' }), undefined).result).rejects.toThrow(
      /ARCA no tiene la factura C 00003-00000012/,
    );
  });

  it('una ND comun con el asociado en ARCA pasa sin cambios', async () => {
    const input = note({ shortcut: 'ndc', totalAmount: 5000 });

    await expect(check(input, issued()).result).resolves.toEqual({ input, warnings: [] });
  });

  it('si ARCA no responde, una ND comun sigue con un aviso', async () => {
    const input = note({ shortcut: 'ndc' });

    await expect(check(input, new Error('ARCA no disponible')).result).resolves.toEqual({
      input,
      warnings: ['No se pudo verificar en ARCA que exista la factura C 00003-00000012: ARCA no disponible'],
    });
  });

  it('si ARCA no responde, una NC comun sigue con un aviso', async () => {
    const input = note();

    await expect(check(input, new Error('ARCA no disponible')).result).resolves.toEqual({
      input,
      warnings: [
        'No se pudo verificar en ARCA que la nota de crédito no supere la factura C 00003-00000012: ARCA no disponible',
      ],
    });
  });

  it('no consulta el asociado de otro CUIT: si no existe, decide ARCA al emitir', async () => {
    const input = note({ associatedVoucher: { cuit: '20999999999', numero: 12, puntoVenta: 3, shortcut: 'fc' } });
    const otherCuit = check(input, undefined);

    await expect(otherCuit.result).resolves.toEqual({ input, warnings: [] });
    expect(otherCuit.gateway.getVoucher).not.toHaveBeenCalled();
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
    const { input } = await result;

    expect(gateway.getVoucher).toHaveBeenCalledWith(7, 3, 201);
    expect(input.associatedVoucher?.fecha).toBe('10/03/2026');
    expect(new BillingService().buildVoucherPayload(input, runtime).CbtesAsoc).toEqual([
      { CbteFch: '20260310', Cuit: String(EMITTER), Nro: 7, PtoVta: 3, Tipo: 201 },
    ]);
  });

  it('con --afecha una ND FCE conserva su fecha (la consulta solo controla que el asociado exista)', async () => {
    const input = fceNote({
      associatedVoucher: { fecha: '05/03/2026', numero: 7, puntoVenta: 3, shortcut: 'fcea' },
      shortcut: 'ndea',
    });

    await expect(check(input, issued({ date: '20260310' })).result).resolves.toEqual({ input, warnings: [] });
  });

  it('si ARCA no tiene el asociado, frena: sin fecha la nota FCE no se puede emitir', async () => {
    await expect(check(fceNote(), undefined).result).rejects.toMatchObject({
      code: 'INPUT_VALIDATION_ERROR',
      message: expect.stringContaining('ARCA no tiene la factura de crédito electrónica A 00003-00000007'),
    });
  });

  it('si ARCA no responde, frena igual que si no lo tuviera, y sugiere `--afecha`', async () => {
    await expect(check(fceNote(), new Error('ARCA no disponible')).result).rejects.toMatchObject({
      code: 'INPUT_VALIDATION_ERROR',
      message: expect.stringContaining(
        'No se pudo consultar en ARCA la factura de crédito electrónica A 00003-00000007',
      ),
      suggestion: expect.stringContaining('`--afecha <fecha>`'),
    });
  });

  it('una fecha de ARCA posterior a la nota sigue siendo un error', async () => {
    const { input } = await check(fceNote(), issued({ date: '20260320', total: 5000 })).result;

    expect(() => new BillingService().buildVoucherPayload(input, runtime)).toThrow(/no puede ser posterior/);
  });
});

describe('checkFceCancellationInRegistry: el comprador tiene que rechazar el asociado (10154)', () => {
  const cancellation = (overrides: Partial<BillingCommandInput> = {}) =>
    fceNote({
      associatedVoucher: { fecha: '05/03/2026', numero: 7, puntoVenta: 3, shortcut: 'fcea' },
      cancellation: true,
      ...overrides,
    });

  function registry(state: FceRegistryState | undefined | Error, input = cancellation()) {
    const gateway = {
      getVoucherState: vi.fn(async () => {
        if (state instanceof Error) {
          throw state;
        }

        return state;
      }),
    };
    const result = checkFceCancellationInRegistry({ gateway, input, runtime, service: new BillingService() });

    return { gateway, result };
  }

  it('consulta el asociado propio en el Registro y, si está rechazado, no avisa', async () => {
    const { gateway, result } = registry('Rechazado');

    expect(await result).toEqual([]);
    expect(gateway.getVoucherState).toHaveBeenCalledWith({ arcaType: 201, cuit: EMITTER, number: 7, pointOfSale: 3 });
  });

  it('si no está rechazado avisa el 10154, con el estado y qué hacer', async () => {
    expect(await registry('Aceptado').result).toEqual([
      'El comprador no rechazó la factura de crédito electrónica A 00003-00000007 en el Registro de FCE (estado: aceptado) y la nota de anulación lo necesita: ARCA la rechaza con el error 10154. Pedile al comprador que lo rechace o, si no es una anulación, emitila sin `--anulacion`.',
    ]);
    expect(await registry('Recepcionado').result).toEqual([expect.stringContaining('(estado: recibido)')]);
  });

  it('sobre otra nota FCE no sugiere sacar `--anulacion`: ahí es obligatoria', async () => {
    const overNote = cancellation({
      associatedVoucher: { fecha: '05/03/2026', numero: 1, puntoVenta: 3, shortcut: 'ndea' },
    });
    const warnings = await registry('PendienteRecepcion', overNote).result;

    expect(warnings).toEqual([
      expect.stringMatching(/nota de débito.*\(estado: pendiente de recepción\).*antes de emitir\.$/),
    ]);
    expect(warnings[0]).not.toContain('--anulacion');
  });

  it('si el Registro no lo tiene, no avisa: que exista lo controla ARCA', async () => {
    expect(await registry(undefined).result).toEqual([]);
  });

  it('si wsfecred no responde, avisa sin frenar', async () => {
    expect(await registry(new Error('El certificado no está autorizado para el servicio wsfecred.')).result).toEqual([
      'No se pudo consultar en el Registro de FCE si el comprador rechazó la factura de crédito electrónica A 00003-00000007: El certificado no está autorizado para el servicio wsfecred. Si no lo rechazó, ARCA rechaza la nota de anulación con el error 10154.',
    ]);
  });

  it('no consulta sin `--anulacion`, en notas comunes ni con el asociado de otro CUIT', async () => {
    const gateway = { getVoucherState: vi.fn() };
    const service = new BillingService();
    const inputs = [
      cancellation({ cancellation: false }),
      note(),
      cancellation({
        associatedVoucher: { cuit: '30709965812', fecha: '05/03/2026', numero: 7, puntoVenta: 3, shortcut: 'fcea' },
      }),
    ];

    for (const input of inputs) {
      expect(await checkFceCancellationInRegistry({ gateway, input, runtime, service })).toEqual([]);
    }

    expect(gateway.getVoucherState).not.toHaveBeenCalled();
  });
});
