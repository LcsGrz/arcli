import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArcaClient } from '../../../services/arca/arca-client.factory';
import { ArcaVoucherHistoryGateway } from '../../../services/arca/arca-voucher-history.gateway';
import { systemClock } from '../../../services/time/system-clock';
import type { FceRegistryState } from '../../fce/fce-registry';
import type { IssuedVoucher } from '../../vouchers/voucher-history';
import {
  assertCreditNoteWithinAssociated,
  checkAssociatedInArca,
  checkFceCancellationInRegistry,
} from '../billing.associated-lookup';
import type { BillingCommandInput } from '../billing.schemas';
import { BillingService } from '../billing.service';
import type { BillingRuntime } from '../billing.types.internal';

const EMITTER = 20123456786;

const runtime: BillingRuntime = { cuit: EMITTER, environment: 'testing', pointOfSale: 3 };

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

/** El asociado de `fceNote`: una factura FCE al mismo receptor, en pesos. */
const fceIssued = (overrides: Partial<IssuedVoucher> = {}) =>
  issued({ documentNumber: 30709965812, documentTypeCode: 80, ...overrides });

/**
 * `salesPoints` son los puntos de venta de web service del emisor (`FEParamGetPtosVenta`) y `lastNumber`, el ultimo
 * numero de ARCA en el punto de venta del asociado. Por defecto, el PV 3 es de web service.
 */
function check(
  input: BillingCommandInput,
  voucher: IssuedVoucher | undefined | Error,
  pointsOfSale: { readonly lastNumber?: Error | number; readonly salesPoints?: Error | number[] } = {},
) {
  const { lastNumber = 0, salesPoints = [3] } = pointsOfSale;
  const gateway = {
    getLastNumber: vi.fn(async () => {
      if (lastNumber instanceof Error) {
        throw lastNumber;
      }

      return lastNumber;
    }),
    getVoucher: vi.fn(async () => {
      if (voucher instanceof Error) {
        throw voucher;
      }

      return voucher;
    }),
  };
  const parameters = {
    getSalesPoints: vi.fn(async () => {
      if (salesPoints instanceof Error) {
        throw salesPoints;
      }

      return salesPoints.map((number) => ({ blocked: false, emissionType: 'CAE - RECE', number }));
    }),
  };
  const result = checkAssociatedInArca({
    gateway,
    input,
    runtime,
    salesPoints: parameters,
    service: new BillingService({ clock: systemClock }),
  });

  return { gateway, parameters, result };
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
    const input = fceNote({ associatedVoucher: { fecha: '10/03/2026', numero: 7, puntoVenta: 3, shortcut: 'fcea' } });

    await expect(check(input, fceIssued({ total: 5000 })).result).resolves.toEqual({ input, warnings: [] });
    await expect(check(input, fceIssued({ total: 500 })).result).rejects.toThrow(/no puede superar/);
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

  describe.each([
    [600, 'ValidacionDeToken'],
    [10005, 'El punto de venta no es CAE'],
    [11002, 'El punto de venta no se encuentra habilitado a usar el presente WS'],
  ])('si ARCA contesta con el error %i (ERR-1)', (code, msg) => {
    // El gateway real, con `FECompConsultar` contestando un error que no es el 602.
    const history = {
      getLastNumber: async (): Promise<number> => {
        throw new Error('11002');
      },
      getVoucher: ArcaVoucherHistoryGateway.prototype.getVoucher.bind({
        arca: {
          genericService: {
            call: async () => ({ FECompConsultarResult: { Errors: { Err: { Code: code, Msg: msg } } } }),
          },
        },
      }),
    };
    const checkWithError = (input: BillingCommandInput, salesPoints: Error | number[] = [3, 9]) =>
      checkAssociatedInArca({
        gateway: history,
        input,
        runtime,
        salesPoints: {
          getSalesPoints: async () => {
            if (salesPoints instanceof Error) {
              throw salesPoints;
            }

            return salesPoints.map((number) => ({ blocked: false, emissionType: 'CAE', number }));
          },
        },
        service: new BillingService({ clock: systemClock }),
      });
    const at50 = (shortcut: 'fc' | 'fcea', fecha?: string) => ({
      ...(fecha ? { fecha } : {}),
      numero: 15,
      puntoVenta: 50,
      shortcut,
    });

    it.each([
      ['NC común', note(), 'que la nota de crédito no supere la factura C 00003-00000012'],
      ['ND común', note({ shortcut: 'ndc' }), 'que exista la factura C 00003-00000012'],
      [
        'ND FCE con --afecha',
        fceNote({
          associatedVoucher: { fecha: '05/03/2026', numero: 7, puntoVenta: 3, shortcut: 'fcea' },
          shortcut: 'ndea',
        }),
        'que exista la factura de crédito electrónica A 00003-00000007',
      ],
    ])('en un PV propio, %s: sigue con el aviso, sin repetirse', async (_case, input, unchecked) => {
      await expect(checkWithError(input)).resolves.toEqual({
        input,
        warnings: [`No se pudo verificar en ARCA ${unchecked}: ${code} ${msg}`],
      });
    });

    it('en un PV propio, una nota FCE sin --afecha frena sin decir que ARCA no lo tiene', async () => {
      await expect(checkWithError(fceNote())).rejects.toMatchObject({
        code: 'INPUT_VALIDATION_ERROR',
        message: `No se pudo consultar en ARCA la factura de crédito electrónica A 00003-00000007 para tomar su fecha: ${code} ${msg}`,
        suggestion: 'Probá de nuevo en un rato o pasá la fecha del asociado con `--afecha <fecha>`.',
      });
    });

    it('en un PV de otro sistema sigue el camino del 602, con el motivo del error (REGLAS-1)', async () => {
      const rest =
        'y el punto de venta 50 no es de web service: si es de Comprobantes en línea, de un controlador fiscal o de otro sistema, está bien; si no, revisá `--ar`, `--apv` y `--ac`.';

      for (const [input, label, more] of [
        [
          note({ associatedVoucher: at50('fc') }),
          'la factura C',
          ' No se pudo controlar que la nota de crédito no lo supere. Si es de un controlador fiscal o de FactuWeb, ARCA pide su fecha (error 10211): pasala con `--afecha`.',
        ],
        [note({ associatedVoucher: at50('fc', '10/03/2026'), shortcut: 'ndc' }), 'la factura C', ''],
        [
          fceNote({ associatedVoucher: at50('fcea', '05/03/2026') }),
          'la factura de crédito electrónica A',
          ' No se pudo controlar que la nota de crédito no lo supere.',
        ],
      ] as const) {
        await expect(checkWithError(input)).resolves.toEqual({
          input: (await check(input, undefined, { salesPoints: [3, 9] }).result).input,
          warnings: [`No se pudo consultar ${label} 00050-00000015 en ARCA (${code} ${msg}) ${rest}${more}`],
        });
      }
    });

    it('en un PV de otro sistema, una nota FCE sin --afecha frena con el motivo y la sugerencia del 602', async () => {
      await expect(checkWithError(fceNote({ associatedVoucher: at50('fcea') }))).rejects.toMatchObject({
        code: 'INPUT_VALIDATION_ERROR',
        message: `No se pudo consultar la factura de crédito electrónica A 00050-00000015 en ARCA (${code} ${msg}) y el punto de venta 50 no es de web service, así que no se puede tomar su fecha.`,
        suggestion:
          'Si es de Comprobantes en línea o de un controlador fiscal, pasá su fecha con `--afecha <fecha>`. Si no, revisá `--ar`, `--apv` y `--ac`.',
      });
    });

    it('en un PV propio, con la lista vacía y el último número en 0, gana el error original', async () => {
      const gateway = { ...history, getLastNumber: async () => 0 };
      const salesPoints = { getSalesPoints: async () => [] };
      const service = new BillingService({ clock: systemClock });

      await expect(
        checkAssociatedInArca({ gateway, input: note(), runtime, salesPoints, service }),
      ).resolves.toMatchObject({
        warnings: [
          `No se pudo verificar en ARCA que la nota de crédito no supere la factura C 00003-00000012: ${code} ${msg}`,
        ],
      });
      await expect(
        checkAssociatedInArca({ gateway, input: fceNote(), runtime, salesPoints, service }),
      ).rejects.toMatchObject({
        suggestion: 'Probá de nuevo en un rato o pasá la fecha del asociado con `--afecha <fecha>`.',
      });
    });

    it.each([
      ['la lista viene vacía y el último número falla', [] as number[]],
      ['falla todo', new Error('timeout')],
    ])('si no se puede clasificar (%s) gana el error original', async (_case, salesPoints) => {
      const input = note({ associatedVoucher: at50('fc') });

      await expect(checkWithError(input, salesPoints)).resolves.toEqual({
        input,
        warnings: [
          `No se pudo verificar en ARCA que la nota de crédito no supere la factura C 00050-00000015: ${code} ${msg}`,
        ],
      });
    });
  });

  it('una respuesta inesperada (ERR-1): el aviso lo dice sin repetirse', async () => {
    const gateway = new ArcaVoucherHistoryGateway({
      genericService: { call: async () => null },
    } as unknown as ArcaClient);

    await expect(
      checkAssociatedInArca({ gateway, input: note(), runtime, service: new BillingService({ clock: systemClock }) }),
    ).resolves.toMatchObject({
      warnings: [
        'No se pudo verificar en ARCA que la nota de crédito no supere la factura C 00003-00000012: respuesta inesperada',
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

describe('checkAssociatedInArca: asociado que ARCA no tiene, segun su punto de venta (REGLAS-1)', () => {
  const onPointOfSale50 = (overrides: Partial<BillingCommandInput> = {}) =>
    note({ associatedVoucher: { cuit: String(EMITTER), numero: 15, puntoVenta: 50, shortcut: 'fc' }, ...overrides });

  it('en un punto de venta de web service del emisor frena: es casi seguro un numero mal escrito', async () => {
    const { parameters, result } = check(note(), undefined, { salesPoints: [3, 9] });

    await expect(result).rejects.toThrow('ARCA no tiene la factura C 00003-00000012.');
    expect(parameters.getSalesPoints).toHaveBeenCalledTimes(1);
  });

  it('en un punto de venta que no es de web service sigue con un aviso (Comprobantes en linea, controlador fiscal)', async () => {
    const input = onPointOfSale50();
    const { gateway, result } = check(input, undefined, { salesPoints: [3, 9] });

    await expect(result).resolves.toEqual({
      input,
      warnings: [
        'No se encontró la factura C 00050-00000015 en ARCA y el punto de venta 50 no es de web service: si es de Comprobantes en línea, de un controlador fiscal o de otro sistema, está bien; si no, revisá `--ar`, `--apv` y `--ac`. No se pudo controlar que la nota de crédito no lo supere. Si es de un controlador fiscal o de FactuWeb, ARCA pide su fecha (error 10211): pasala con `--afecha`.',
      ],
    });
    // Con la lista de puntos de venta alcanza: no hace falta mirar el ultimo numero.
    expect(gateway.getLastNumber).not.toHaveBeenCalled();
  });

  it('una ND con --afecha sobre un asociado de otro sistema solo avisa que no se encontro', async () => {
    const input = onPointOfSale50({
      associatedVoucher: { cuit: String(EMITTER), fecha: '10/03/2026', numero: 15, puntoVenta: 50, shortcut: 'fc' },
      shortcut: 'ndc',
    });

    await expect(check(input, undefined, { salesPoints: [3] }).result).resolves.toEqual({
      input,
      warnings: [
        'No se encontró la factura C 00050-00000015 en ARCA y el punto de venta 50 no es de web service: si es de Comprobantes en línea, de un controlador fiscal o de otro sistema, está bien; si no, revisá `--ar`, `--apv` y `--ac`.',
      ],
    });
  });

  it('sin lista de puntos de venta (testing devuelve 602) decide el ultimo numero de ARCA en ese punto de venta', async () => {
    await expect(check(note(), undefined, { lastNumber: 137, salesPoints: [] }).result).rejects.toThrow(
      /ARCA no tiene la factura C 00003-00000012/,
    );

    const input = onPointOfSale50();
    const { gateway, result } = check(input, undefined, { lastNumber: 0, salesPoints: [] });

    await expect(result).resolves.toMatchObject({
      warnings: [expect.stringContaining('el punto de venta 50 no es de web service')],
    });
    expect(gateway.getLastNumber).toHaveBeenCalledWith(50, 11);
  });

  it('si la consulta de puntos de venta falla, avisa en lugar de frenar', async () => {
    const input = onPointOfSale50();

    await expect(
      check(input, undefined, { lastNumber: 0, salesPoints: new Error('ARCA no disponible') }).result,
    ).resolves.toMatchObject({
      warnings: [
        expect.stringContaining(
          'No se encontró la factura C 00050-00000015 en ARCA y no se pudo consultar si el punto de venta 50 es de web service',
        ),
      ],
    });
    await expect(
      check(input, undefined, { lastNumber: new Error('timeout'), salesPoints: new Error('timeout') }).result,
    ).resolves.toMatchObject({ warnings: [expect.stringContaining('no se pudo consultar')] });
  });

  it('una nota FCE sobre un asociado de otro sistema sin --afecha frena pidiendo la fecha', async () => {
    const input = fceNote({ associatedVoucher: { numero: 7, puntoVenta: 50, shortcut: 'fcea' } });

    await expect(check(input, undefined, { salesPoints: [3] }).result).rejects.toMatchObject({
      code: 'INPUT_VALIDATION_ERROR',
      message:
        'No se encontró la factura de crédito electrónica A 00050-00000007 en ARCA, así que no se puede tomar su fecha.',
      suggestion:
        'Si es de Comprobantes en línea o de un controlador fiscal, pasá su fecha con `--afecha <fecha>`. Si no, revisá `--ar`, `--apv` y `--ac`.',
    });
  });

  it('una nota FCE sobre un asociado de otro sistema con --afecha sigue con el aviso', async () => {
    const input = fceNote({ associatedVoucher: { fecha: '05/03/2026', numero: 7, puntoVenta: 50, shortcut: 'fcea' } });

    await expect(check(input, undefined, { salesPoints: [3] }).result).resolves.toMatchObject({
      input,
      warnings: [expect.stringContaining('No se encontró la factura de crédito electrónica A 00050-00000007 en ARCA')],
    });
  });
});

describe('checkAssociatedInArca: fecha del asociado en notas FCE (REV-46)', () => {
  it('sin --afecha toma la fecha del asociado en ARCA', async () => {
    const { gateway, result } = check(fceNote({ shortcut: 'ndea' }), fceIssued({ date: '20260310' }));
    const { input } = await result;

    expect(gateway.getVoucher).toHaveBeenCalledWith(7, 3, 201);
    expect(input.associatedVoucher?.fecha).toBe('10/03/2026');
    expect(new BillingService({ clock: systemClock }).buildVoucherPayload(input, runtime).CbtesAsoc).toEqual([
      { CbteFch: '20260310', Cuit: String(EMITTER), Nro: 7, PtoVta: 3, Tipo: 201 },
    ]);
  });

  it('con --afecha igual a la de ARCA una ND FCE conserva su fecha', async () => {
    const input = fceNote({
      associatedVoucher: { fecha: '10/03/2026', numero: 7, puntoVenta: 3, shortcut: 'fcea' },
      shortcut: 'ndea',
    });

    await expect(check(input, fceIssued({ date: '20260310' })).result).resolves.toEqual({ input, warnings: [] });
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
    const { input } = await check(fceNote(), fceIssued({ date: '20260320', total: 5000 })).result;

    expect(() => new BillingService({ clock: systemClock }).buildVoucherPayload(input, runtime)).toThrow(
      /no puede ser posterior/,
    );
  });
});

describe('checkAssociatedInArca: la nota FCE coincide con su asociado (REGLAS-12)', () => {
  it('frena otra moneda que la del asociado (10181)', async () => {
    const input = fceNote({ currencyCode: 'EUR', exchangeRate: 1300 });

    await expect(check(input, fceIssued({ currency: 'DOL', total: 5000 })).result).rejects.toMatchObject({
      code: 'INPUT_VALIDATION_ERROR',
      message:
        'La nota de crédito electrónica A va en la moneda de la factura de crédito electrónica A 00003-00000007 (DOL) o en pesos, no en 060: ARCA la rechaza (error 10181).',
      suggestion: 'Usá `--moneda DOL`, o pesos si ajusta una diferencia de cambio.',
    });
  });

  it('acepta la misma moneda o pesos, para una diferencia de cambio (10181)', async () => {
    const dollars = fceNote({ currencyCode: 'USD', exchangeRate: 1300, shortcut: 'ndea' });
    const pesos = fceNote({ shortcut: 'ndea' });

    await expect(check(dollars, fceIssued({ currency: 'DOL' })).result).resolves.toMatchObject({ warnings: [] });
    await expect(check(pesos, fceIssued({ currency: 'DOL' })).result).resolves.toMatchObject({ warnings: [] });
  });

  it('frena otro receptor que el del asociado (10183)', async () => {
    await expect(check(fceNote(), fceIssued({ documentNumber: 30546689979 })).result).rejects.toMatchObject({
      message: expect.stringContaining('al mismo receptor que la factura de crédito electrónica A 00003-00000007'),
      suggestion: 'Usá `--cuit 30546689979`.',
    });
  });

  it('frena un --afecha distinto de la fecha del asociado en ARCA (10160)', async () => {
    const input = fceNote({ associatedVoucher: { fecha: '05/03/2026', numero: 7, puntoVenta: 3, shortcut: 'fcea' } });

    await expect(check(input, fceIssued({ date: '20260310', total: 5000 })).result).rejects.toMatchObject({
      message:
        'La fecha del asociado (05/03/2026) no es la de la factura de crédito electrónica A 00003-00000007 en ARCA (10/03/2026): en la nota de crédito electrónica A ARCA la rechaza (error 10160).',
      suggestion: 'Usá `--afecha 10/03/2026`, o sacala y ARCLI la toma de ARCA.',
    });
  });

  it('en las notas comunes no compara moneda, receptor ni fecha', async () => {
    const input = note({
      associatedVoucher: { cuit: String(EMITTER), fecha: '01/03/2026', numero: 12, puntoVenta: 3, shortcut: 'fc' },
    });

    await expect(
      check(input, issued({ currency: 'DOL', date: '20260310', documentNumber: 30546689979 })).result,
    ).resolves.toEqual({ input, warnings: [] });
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
    const result = checkFceCancellationInRegistry({
      gateway,
      input,
      runtime,
      service: new BillingService({ clock: systemClock }),
    });

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

  it('un error de archivo al consultar el Registro va traducido', async () => {
    const failure = Object.assign(new Error("EACCES: permission denied, open '/Users/ana/x/y.json'"), {
      code: 'EACCES',
      path: '/Users/ana/x/y.json',
      syscall: 'open',
    });

    expect((await registry(failure).result)[0]).toContain(
      ': No se pudo abrir .../x/y.json: no tenés permiso. Si no lo rechazó',
    );
  });

  it('si wsfecred no responde, avisa sin frenar', async () => {
    expect(await registry(new Error('El certificado no está autorizado para el servicio wsfecred.')).result).toEqual([
      'No se pudo consultar en el Registro de FCE si el comprador rechazó la factura de crédito electrónica A 00003-00000007: El certificado no está autorizado para el servicio wsfecred. Si no lo rechazó, ARCA rechaza la nota de anulación con el error 10154.',
    ]);
  });

  it('no consulta sin `--anulacion`, en notas comunes ni con el asociado de otro CUIT', async () => {
    const gateway = { getVoucherState: vi.fn() };
    const service = new BillingService({ clock: systemClock });
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

describe('un asociado que existe y ARCLI no pudo leer (ARQ-22)', () => {
  const checkUnreadable = async (input: BillingCommandInput) => {
    const call = vi.fn(async (_service: string, _method: string, params: { FeCompConsReq: { CbteNro: number } }) => ({
      FECompConsultarResult: {
        ResultGet: { CbteDesde: params.FeCompConsReq.CbteNro, CodAutorizacion: '75123456789012' },
      },
    }));
    const getSalesPoints = vi.fn(async () => [{ blocked: false, emissionType: 'CAE', number: 99 }]);
    const result = await checkAssociatedInArca({
      gateway: new ArcaVoucherHistoryGateway({ genericService: { call } } as unknown as ArcaClient),
      input,
      runtime,
      salesPoints: { getSalesPoints },
      service: new BillingService({ clock: { now: () => new Date('2026-03-18T15:00:00Z') } }),
    }).finally(() => {
      // Existe en ARCA: no es de otro sistema, aunque el punto de venta no figure.
      expect(getSalesPoints).not.toHaveBeenCalled();
    });

    expect(result.input).toBe(input);

    return result.warnings;
  };
  const withDate = (shortcut: 'ncea' | 'ndea') =>
    fceNote({ associatedVoucher: { fecha: '10/03/2026', numero: 7, puntoVenta: 3, shortcut: 'fcea' }, shortcut });
  const FC = 'ARCLI no pudo leer los datos de la factura C 00003-00000012, que existe en ARCA';
  const FCEA = 'ARCLI no pudo leer los datos de la factura de crédito electrónica A 00003-00000007, que existe en ARCA';

  it.each<[string, BillingCommandInput, string]>([
    ['NC', note(), `${FC}: queda sin controlar que la nota de crédito no lo supere.`],
    ['ND', note({ shortcut: 'ndc' }), `${FC}.`],
    [
      'NC FCE con --afecha',
      withDate('ncea'),
      `${FCEA}: queda sin controlar que coincidan la moneda, el receptor y la fecha y que la nota de crédito no lo supere.`,
    ],
    [
      'ND FCE con --afecha',
      withDate('ndea'),
      `${FCEA}: queda sin controlar que coincidan la moneda, el receptor y la fecha.`,
    ],
  ])('%s: avisa qué queda sin controlar y sigue', async (_name, input, warning) => {
    expect(await checkUnreadable(input)).toEqual([warning]);
  });

  it('una nota FCE sin --afecha frena y pide la fecha, sin mandar a reintentar', async () => {
    await expect(checkUnreadable(fceNote())).rejects.toMatchObject({
      code: 'INPUT_VALIDATION_ERROR',
      message: `${FCEA}: no se puede tomar su fecha.`,
      suggestion: 'Pasá la fecha del asociado con `--afecha <fecha>`.',
    });
  });
});
