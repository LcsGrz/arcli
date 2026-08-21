import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedArcaRuntime } from '../../../services/arca/arca-context.resolver';
import type { BillingCommandInput } from '../billing.schemas';
import { BillingService } from '../billing.service';
import { mapBillingResponse } from '../billing-response';

function createRuntime(): ResolvedArcaRuntime {
  return {
    config: {
      cert: {},
      entornoPorDefecto: 'testing',
      key: {},
      output: {
        emitirPorDefecto: false,
        brutoPorDefecto: false,
        jsonPorDefecto: false,
      },
      puntoVentaPorDefecto: 3,
    },
    context: {
      cert: 'CERT',
      cuit: 20123456789,
      key: 'KEY',
      production: false,
    },
    environment: 'testing',
    outputJson: false,
    outputRaw: false,
    pointOfSale: 3,
  };
}

function createBillingInput(overrides: Partial<BillingCommandInput> = {}): BillingCommandInput {
  return {
    concept: 'servicios',
    currencyCode: 'PES',
    documentType: 'consumidor-final',
    dryRun: true,
    emit: false,
    exchangeRate: 1,
    ivaCondition: 'consumidor-final',
    shortcut: 'fa',
    totalAmount: 1000,
    ...overrides,
  };
}

describe('billing.service', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds invoice payload with default service dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T12:00:00Z'));

    const service = new BillingService();

    const payload = service.buildVoucherPayload(createBillingInput(), createRuntime());

    expect(payload).toMatchObject({
      CbteFch: '20260318',
      CbteTipo: 1,
      Concepto: 2,
      DocTipo: 99,
      ImpNeto: 1000,
      ImpTotal: 1000,
      MonCotiz: 1,
      MonId: 'PES',
      PtoVta: 3,
    });
    expect(payload.FchServDesde).toBe('20260318');
    expect(payload.FchServHasta).toBe('20260318');
    expect(payload.FchVtoPago).toBe('20260318');
    expect(payload.DocNro).toBeUndefined();
  });

  it('uses today as billing date when no explicit date is provided', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T12:00:00Z'));

    const service = new BillingService();

    const payload = service.buildVoucherPayload(
      createBillingInput({ concept: 'productos', shortcut: 'fc' }),
      createRuntime(),
    );

    expect(payload.CbteFch).toBe('20260318');
  });

  it('builds invoice payload with explicit billing date in Argentine format', () => {
    const service = new BillingService();

    const payload = service.buildVoucherPayload(
      createBillingInput({
        billingDate: '18-03-2026',
        concept: 'productos',
        documentNumber: 12345678,
        documentType: 'dni',
        shortcut: 'fb',
        totalAmount: 5000,
      }),
      createRuntime(),
    );

    expect(payload.CbteFch).toBe('20260318');
    expect(payload.FchServDesde).toBeUndefined();
    expect(payload.FchServHasta).toBeUndefined();
    expect(payload.FchVtoPago).toBeUndefined();
  });

  it('accepts slash-separated Argentine dates', () => {
    const service = new BillingService();

    const payload = service.buildVoucherPayload(
      createBillingInput({
        billingDate: '18/03/2026',
        concept: 'productos',
        documentNumber: 12345678,
        documentType: 'dni',
        shortcut: 'fb',
      }),
      createRuntime(),
    );

    expect(payload.CbteFch).toBe('20260318');
  });

  it('uses the current year when Argentine dates omit it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T12:00:00Z'));

    const service = new BillingService();

    const payload = service.buildVoucherPayload(
      createBillingInput({
        billingDate: '09-08',
        serviceEndDate: '31/08',
        serviceStartDate: '01/08',
      }),
      createRuntime(),
    );

    expect(payload.CbteFch).toBe('20260809');
    expect(payload.FchServDesde).toBe('20260801');
    expect(payload.FchServHasta).toBe('20260831');
    expect(payload.FchVtoPago).toBe('20260831');
  });

  it('uses the current month and year when Argentine dates only include the day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T12:00:00Z'));

    const service = new BillingService();

    const payload = service.buildVoucherPayload(
      createBillingInput({
        billingDate: '5',
        serviceEndDate: '15',
        serviceStartDate: '05',
      }),
      createRuntime(),
    );

    expect(payload.CbteFch).toBe('20260805');
    expect(payload.FchServDesde).toBe('20260805');
    expect(payload.FchServHasta).toBe('20260815');
    expect(payload.FchVtoPago).toBe('20260815');
  });

  it('rejects ISO date input', () => {
    const service = new BillingService();

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          billingDate: '2026-03-18',
          concept: 'productos',
          documentNumber: 12345678,
          documentType: 'dni',
          shortcut: 'fb',
        }),
        createRuntime(),
      ),
    ).toThrow(/Use D, DD, D-MM, D\/MM, D-MM-YY, D\/MM\/YY, D-MM-YYYY o D\/MM\/YYYY/);
  });

  it('rejects impossible Argentine dates', () => {
    const service = new BillingService();

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          billingDate: '31/02/2026',
          concept: 'productos',
          documentNumber: 12345678,
          documentType: 'dni',
          shortcut: 'fb',
        }),
        createRuntime(),
      ),
    ).toThrow(/La fecha "31\/02\/2026" no es valida/);
  });

  it('requires associated vouchers for credit notes and debit notes', () => {
    const service = new BillingService();

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          documentNumber: 0,
          shortcut: 'nca',
        }),
        createRuntime(),
      ),
    ).toThrow(/requiere comprobante asociado/);
  });

  it('includes associated voucher data when provided', () => {
    const service = new BillingService();

    const payload = service.buildVoucherPayload(
      createBillingInput({
        associatedVoucher: {
          cuit: '20123456789',
          numero: 123,
          puntoVenta: 3,
          tipo: 11,
        },
        documentNumber: 0,
        shortcut: 'ndc',
      }),
      createRuntime(),
    );

    expect(payload.CbtesAsoc).toEqual([
      {
        Cuit: '20123456789',
        Nro: 123,
        PtoVta: 3,
        Tipo: 11,
      },
    ]);
  });

  it('resolves associated voucher type from shortcut when provided', () => {
    const service = new BillingService();

    const payload = service.buildVoucherPayload(
      createBillingInput({
        associatedVoucher: {
          cuit: '20123456789',
          numero: 123,
          puntoVenta: 3,
          shortcut: 'fa',
        },
        documentNumber: 0,
        shortcut: 'nca',
      }),
      createRuntime(),
    );

    expect(payload.CbtesAsoc?.[0]?.Tipo).toBe(1);
  });

  it('supports custom currency and exchange rate', () => {
    const service = new BillingService();

    const payload = service.buildVoucherPayload(
      createBillingInput({
        currencyCode: 'USD',
        documentNumber: 0,
        exchangeRate: 1200.5,
      }),
      createRuntime(),
    );

    expect(payload.MonId).toBe('USD');
    expect(payload.MonCotiz).toBe(1200.5);
  });

  it('builds IVA automatically for factura A with responsable inscripto', () => {
    const service = new BillingService();

    const payload = service.buildVoucherPayload(
      createBillingInput({
        documentNumber: 20123456789,
        documentType: 'cuit',
        ivaCondition: 'responsable-inscripto',
        totalAmount: 121,
      }),
      createRuntime(),
    );

    expect(payload.ImpNeto).toBe(100);
    expect(payload.ImpIVA).toBe(21);
    expect(payload.Iva).toEqual([
      {
        BaseImp: 100,
        Id: 5,
        Importe: 21,
      },
    ]);
  });

  it('builds IVA automatically for factura B', () => {
    const service = new BillingService();

    const payload = service.buildVoucherPayload(
      createBillingInput({
        documentNumber: 12345678,
        documentType: 'dni',
        shortcut: 'fb',
        totalAmount: 121,
      }),
      createRuntime(),
    );

    expect(payload.ImpNeto).toBe(100);
    expect(payload.ImpIVA).toBe(21);
    expect(payload.Iva).toEqual([
      {
        BaseImp: 100,
        Id: 5,
        Importe: 21,
      },
    ]);
  });

  it('requires a receiver document when document type is not consumer final', () => {
    const service = new BillingService();

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          documentType: 'cuit',
          ivaCondition: 'responsable-inscripto',
        }),
        createRuntime(),
      ),
    ).toThrow(/requiere documento del receptor/);
  });

  it('rejects consumer final with a non-zero document number', () => {
    const service = new BillingService();

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          documentNumber: 123,
        }),
        createRuntime(),
      ),
    ).toThrow(/consumidor final solo con documento 0/);
  });

  it('rejects consumer final with a non-consumer-final iva condition', () => {
    const service = new BillingService();

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          documentType: 'consumidor-final',
          ivaCondition: 'responsable-inscripto',
        }),
        createRuntime(),
      ),
    ).toThrow(/--ir-cf|consumidor-final/);
  });

  it('rejects cuit or cuil with invalid length', () => {
    const service = new BillingService();

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          documentNumber: 2012345678,
          documentType: 'cuit',
          ivaCondition: 'responsable-inscripto',
        }),
        createRuntime(),
      ),
    ).toThrow(/--cuit debe tener 11 digitos/);
  });

  it('rejects dni with invalid length', () => {
    const service = new BillingService();

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          documentNumber: 123456,
          documentType: 'dni',
        }),
        createRuntime(),
      ),
    ).toThrow(/--dni debe tener 7 u 8 digitos/);
  });

  it('rejects service dates for products concept', () => {
    const service = new BillingService();

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          billingDate: '18-03-2026',
          concept: 'productos',
          documentNumber: 0,
          serviceEndDate: '18-03-2026',
          serviceStartDate: '10-03-2026',
        }),
        createRuntime(),
      ),
    ).toThrow(/no usa fechas de servicio/);
  });

  it('requires both service dates when one is provided', () => {
    const service = new BillingService();

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          billingDate: '18-03-2026',
          documentNumber: 0,
          serviceStartDate: '10-03-2026',
        }),
        createRuntime(),
      ),
    ).toThrow(/debe enviar ambas/);
  });

  it('rejects invalid service date ranges', () => {
    const service = new BillingService();

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          billingDate: '18-03-2026',
          documentNumber: 0,
          serviceEndDate: '10-03-2026',
          serviceStartDate: '20-03-2026',
        }),
        createRuntime(),
      ),
    ).toThrow(/inicio de servicio no puede ser posterior/);
  });

  it('rejects associated vouchers on invoice types that do not support them', () => {
    const service = new BillingService();

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          associatedVoucher: {
            cuit: '20123456789',
            numero: 99,
            puntoVenta: 3,
            tipo: 11,
          },
          documentNumber: 0,
        }),
        createRuntime(),
      ),
    ).toThrow(/no usa comprobante asociado/);
  });

  it('rejects associated vouchers with a different letter when shortcut is provided', () => {
    const service = new BillingService();

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          associatedVoucher: {
            cuit: '20123456789',
            numero: 99,
            puntoVenta: 3,
            shortcut: 'fc',
          },
          documentNumber: 0,
          shortcut: 'nca',
        }),
        createRuntime(),
      ),
    ).toThrow(/misma letra/);
  });

  it('rejects associated vouchers that are not invoices when shortcut is provided', () => {
    const service = new BillingService();

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          associatedVoucher: {
            cuit: '20123456789',
            numero: 99,
            puntoVenta: 3,
            shortcut: 'nda',
          },
          documentNumber: 0,
          shortcut: 'nca',
        }),
        createRuntime(),
      ),
    ).toThrow(/debe ser una factura, no otra nota/);
  });

  it('returns a mapped dry-run response without calling the gateway', async () => {
    const service = new BillingService();

    const result = await service.execute({
      gateway: {
        createNextVoucher: async () => {
          throw new Error('No deberia ejecutarse en dry-run');
        },
      },
      input: createBillingInput({
        documentNumber: 0,
      }),
      runtime: createRuntime(),
    });

    expect(result.dryRun).toBe(true);
    expect(result.response).toMatchObject({
      cae: null,
      errors: [],
      events: [],
      resultado: null,
    });
  });

  it('maps ARCA responses into a stable summary', () => {
    const summary = mapBillingResponse({
      cae: '12345678901234',
      caeFchVto: '20260331',
      response: {
        Errors: {
          Err: [{ Code: 1000, Msg: 'Error de prueba' }],
        },
        Events: {
          Evt: [{ Code: 1, Msg: 'Evento de prueba' }],
        },
        FeDetResp: {
          FECAEDetResponse: [
            {
              Observaciones: {
                Obs: [{ Msg: 'Observacion de prueba' }],
              },
              Resultado: 'A',
            },
          ],
        },
      },
    } as never);

    expect(summary).toMatchObject({
      cae: '12345678901234',
      caeVencimiento: '20260331',
      observacion: 'Observacion de prueba',
      resultado: 'A',
    });
    expect(summary.events).toHaveLength(1);
    expect(summary.errors).toHaveLength(1);
  });
});
