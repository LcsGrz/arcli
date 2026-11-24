import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POINT_OF_SALE_GUIDE_URL } from '../../../lib/links';
import { systemClock } from '../../../services/time/system-clock';
import { billingAnswer } from '../../../testing/arca-answers';
import { EmissionUncertainError } from '../billing.errors';
import { type BillingCommandInput, billingCommandSchema } from '../billing.schemas';
import { BillingService } from '../billing.service';
import type { BillingRuntime } from '../billing.types.internal';
import { mapBillingResponse } from '../billing-response';

import { emitWithBillingAnswer } from './billing-answer.fixture';

function createRuntime(): BillingRuntime {
  return { cuit: 20409509763, environment: 'testing', pointOfSale: 3 };
}

function createBillingInput(overrides: Partial<BillingCommandInput> = {}): BillingCommandInput {
  return {
    cancellation: false,
    concept: 'servicios',
    currencyCode: 'PES',
    documentType: 'consumidor-final',
    dryRun: true,
    emit: false,
    exchangeRate: 1,
    ivaCondition: 'consumidor-final',
    sameCurrency: false,
    shortcut: 'fb',
    totalAmount: 1000,
    ...overrides,
  };
}

describe('billing.service', () => {
  beforeEach(() => {
    // Reloj fijo para todo el archivo: los tests que necesitan otro día lo cambian con setSystemTime.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-18T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops a configured point of sale that does not fit in PtoVta (10004)', () => {
    const service = new BillingService({ clock: systemClock });

    expect(() =>
      service.buildVoucherPayload(createBillingInput(), { ...createRuntime(), pointOfSale: 100_000 }),
    ).toThrow('El punto de venta va de 1 a 99998: ARCA rechaza 100000 (error 10004).');
  });

  it('builds invoice payload with default service dates', () => {
    const service = new BillingService({ clock: systemClock });

    const payload = service.buildVoucherPayload(createBillingInput({ shortcut: 'fc' }), createRuntime());

    expect(payload).toMatchObject({
      CbteFch: '20260318',
      CbteTipo: 11,
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
    // Consumidor final por defecto va con DocNro 0, igual que `--cf` (REV-63).
    expect(payload.DocNro).toBe(0);
  });

  it('sends DocNro 0 for consumidor final with or without an explicit number (REV-63)', () => {
    const service = new BillingService({ clock: systemClock });
    const implicit = service.buildVoucherPayload(createBillingInput({ documentNumber: undefined }), createRuntime());
    const explicit = service.buildVoucherPayload(createBillingInput({ documentNumber: 0 }), createRuntime());

    expect(implicit).toMatchObject({ DocNro: 0, DocTipo: 99 });
    expect(explicit).toEqual(implicit);
  });

  it('uses today as billing date when no explicit date is provided', () => {
    const service = new BillingService({ clock: systemClock });

    const payload = service.buildVoucherPayload(
      createBillingInput({ concept: 'productos', shortcut: 'fc' }),
      createRuntime(),
    );

    expect(payload.CbteFch).toBe('20260318');
  });

  it('uses --dia only for the payment due date, keeping the service period', () => {
    vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));

    const service = new BillingService({ clock: systemClock });
    const alone = service.buildVoucherPayload(
      createBillingInput({ concept: 'servicios', dueDay: 10, shortcut: 'fc' }),
      createRuntime(),
    );
    const withPeriod = service.buildVoucherPayload(
      createBillingInput({
        concept: 'servicios',
        dueDay: 10,
        serviceEndDate: '31/10',
        serviceStartDate: '1/10',
        shortcut: 'fc',
      }),
      createRuntime(),
    );

    expect([alone.FchServDesde, alone.FchServHasta, alone.FchVtoPago]).toEqual(['20261103', '20261103', '20261110']);
    expect([withPeriod.FchServDesde, withPeriod.FchServHasta, withPeriod.FchVtoPago]).toEqual([
      '20261001',
      '20261031',
      '20261110',
    ]);
  });

  it('rejects --dia together with --vencimiento', () => {
    expect(() =>
      new BillingService({ clock: systemClock }).buildVoucherPayload(
        createBillingInput({ concept: 'servicios', dueDay: 10, paymentDueDate: '10/11', shortcut: 'fc' }),
        createRuntime(),
      ),
    ).toThrow(/`--dia` y `--vencimiento` son el mismo vencimiento/);
  });

  it('uses the Argentine date at night, even on a UTC machine', () => {
    // 22:30 del 18/03 en Argentina; en UTC ya es el 19.
    vi.setSystemTime(new Date('2026-03-19T01:30:00Z'));

    const payload = new BillingService({ clock: systemClock }).buildVoucherPayload(
      createBillingInput({ concept: 'servicios', dueDay: 25, shortcut: 'fc' }),
      createRuntime(),
    );

    expect(payload.CbteFch).toBe('20260318');
    expect(payload.FchVtoPago).toBe('20260325');
  });

  it('never builds a payload while the IVA condition still waits for the padron', () => {
    expect(() =>
      new BillingService({ clock: systemClock }).buildVoucherPayload(
        createBillingInput({ documentNumber: 20201797064, documentType: 'cuit', ivaConditionSource: 'missing' }),
        createRuntime(),
      ),
    ).toThrow(/Falta IVA receptor/);
  });

  it('keeps --dia in the next month when today is the 31st', () => {
    vi.setSystemTime(new Date('2026-03-31T12:00:00Z'));

    const payload = new BillingService({ clock: systemClock }).buildVoucherPayload(
      createBillingInput({ concept: 'servicios', dueDay: 15, shortcut: 'fc' }),
      createRuntime(),
    );

    expect(payload.FchServHasta).toBe('20260331');
    expect(payload.FchVtoPago).toBe('20260415');
  });

  it('rolls --dia over to January when it already passed in December', () => {
    vi.setSystemTime(new Date('2026-12-20T12:00:00Z'));

    const payload = new BillingService({ clock: systemClock }).buildVoucherPayload(
      createBillingInput({ concept: 'servicios', dueDay: 10, shortcut: 'fc' }),
      createRuntime(),
    );

    expect(payload.FchVtoPago).toBe('20270110');
  });

  it('rejects --dia when that day does not exist in the month', () => {
    vi.setSystemTime(new Date('2026-03-31T12:00:00Z'));

    expect(() =>
      new BillingService({ clock: systemClock }).buildVoucherPayload(
        createBillingInput({ concept: 'servicios', dueDay: 30, shortcut: 'fc' }),
        createRuntime(),
      ),
    ).not.toThrow();
    // 31 ya paso en marzo y abril no tiene 31.
    vi.setSystemTime(new Date('2026-04-01T12:00:00Z'));
    expect(() =>
      new BillingService({ clock: systemClock }).buildVoucherPayload(
        createBillingInput({ concept: 'servicios', dueDay: 31, shortcut: 'fc' }),
        createRuntime(),
      ),
    ).toThrow(/`--dia 31` no existe en abril de 2026/);
  });

  it('builds invoice payload with explicit billing date in Argentine format', () => {
    const service = new BillingService({ clock: systemClock });

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

  it('uses the current year when Argentine dates omit it', () => {
    vi.setSystemTime(new Date('2026-08-12T12:00:00Z'));

    const service = new BillingService({ clock: systemClock });

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

  it('requires associated vouchers for credit notes and debit notes', () => {
    const service = new BillingService({ clock: systemClock });

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

  it('takes the emitter CUIT when a common note omits --acuit, as ARCA only requires it in FCE (10151)', () => {
    const payload = new BillingService({ clock: systemClock }).buildVoucherPayload(
      createBillingInput({
        associatedVoucher: { numero: 1, puntoVenta: 9, shortcut: 'fb' },
        documentNumber: 0,
        shortcut: 'ncb',
      }),
      createRuntime(),
    );

    expect(payload.CbtesAsoc).toEqual([{ Cuit: '20409509763', Nro: 1, PtoVta: 9, Tipo: 6 }]);
  });

  it('does not ask for --acuit when the associated voucher is incomplete', () => {
    expect(() =>
      new BillingService({ clock: systemClock }).buildVoucherPayload(
        createBillingInput({
          associatedVoucher: { puntoVenta: 9, shortcut: 'fb' },
          documentNumber: 0,
          shortcut: 'ncb',
        }),
        createRuntime(),
      ),
    ).toThrow(
      'Falta el número del comprobante asociado de la nota de crédito B. Usá `--ar <número>`, o un período con `--periodo-desde` y `--periodo-hasta` en vez del comprobante.',
    );
  });

  it('includes associated voucher data when provided', () => {
    const service = new BillingService({ clock: systemClock });

    const payload = service.buildVoucherPayload(
      createBillingInput({
        associatedVoucher: {
          cuit: '20123456786',
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
        Cuit: '20123456786',
        Nro: 123,
        PtoVta: 3,
        Tipo: 11,
      },
    ]);
  });

  it('resolves associated voucher type from shortcut when provided', () => {
    const service = new BillingService({ clock: systemClock });

    const payload = service.buildVoucherPayload(
      createBillingInput({
        associatedVoucher: {
          cuit: '20123456786',
          numero: 123,
          puntoVenta: 3,
          shortcut: 'fa',
        },
        documentNumber: 20123456786,
        documentType: 'cuit',
        ivaCondition: 'responsable-inscripto',
        shortcut: 'nca',
      }),
      createRuntime(),
    );

    expect(payload.CbtesAsoc?.[0]?.Tipo).toBe(1);
  });

  it('supports custom currency and exchange rate', () => {
    const service = new BillingService({ clock: systemClock });

    const payload = service.buildVoucherPayload(
      createBillingInput({
        currencyCode: 'USD',
        documentNumber: 0,
        exchangeRate: 1200.5,
      }),
      createRuntime(),
    );

    expect(payload.MonId).toBe('DOL');
    expect(payload.MonCotiz).toBe(1200.5);
    expect(payload.CanMisMonExt).toBe('N');
  });

  it('does not send CanMisMonExt for pesos', () => {
    const service = new BillingService({ clock: systemClock });

    const payload = service.buildVoucherPayload(createBillingInput({ documentNumber: 0 }), createRuntime());

    expect(payload.MonId).toBe('PES');
    expect(payload.MonCotiz).toBe(1);
    expect(payload).not.toHaveProperty('CanMisMonExt');
  });

  it('rejects foreign currency without an explicit exchange rate', () => {
    const service = new BillingService({ clock: systemClock });

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({ currencyCode: 'USD', documentNumber: 0, exchangeRate: undefined }),
        createRuntime(),
      ),
    ).toThrow(/Falta la cotización de USD/);
    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({ currencyCode: 'USD', documentNumber: 0, exchangeRate: 1 }),
        createRuntime(),
      ),
    ).toThrow(/La cotización de USD no puede ser 1/);
  });

  it('rejects an exchange rate other than 1 for pesos', () => {
    const service = new BillingService({ clock: systemClock });

    expect(() =>
      service.buildVoucherPayload(createBillingInput({ documentNumber: 0, exchangeRate: 1200 }), createRuntime()),
    ).toThrow(/En pesos la cotización tiene que ser 1/);
  });

  it('rejects --misma-moneda for pesos', () => {
    const service = new BillingService({ clock: systemClock });

    expect(() =>
      service.buildVoucherPayload(createBillingInput({ documentNumber: 0, sameCurrency: true }), createRuntime()),
    ).toThrow(/`--misma-moneda` solo aplica/);
  });

  it('resolves the official exchange rate when paying in the same foreign currency', async () => {
    const service = new BillingService({ clock: systemClock });
    const getQuotation = vi.fn(async () => 1415.25);
    const input = await service.resolveExchangeRate(
      createBillingInput({ currencyCode: 'USD', documentNumber: 0, exchangeRate: undefined, sameCurrency: true }),
      { getQuotation },
    );
    const payload = service.buildVoucherPayload(input, createRuntime());

    expect(getQuotation).toHaveBeenCalledWith('DOL');
    expect(payload.MonCotiz).toBe(1415.25);
    expect(payload.CanMisMonExt).toBe('S');
  });

  it('without --cm or --misma-moneda, uses the official exchange rate and marks it to warn', async () => {
    const service = new BillingService({ clock: systemClock });
    const getQuotation = vi.fn(async () => 1415.25);
    const input = await service.resolveExchangeRate(
      createBillingInput({ currencyCode: 'USD', documentNumber: 0, exchangeRate: undefined }),
      { getQuotation },
    );
    const payload = service.buildVoucherPayload(input, createRuntime());

    expect(getQuotation).toHaveBeenCalledWith('DOL');
    expect(input.exchangeRateSource).toBe('arca');
    expect(payload).toMatchObject({ CanMisMonExt: 'N', MonCotiz: 1415.25 });
  });

  it('does not query the exchange rate when it is not needed', async () => {
    const service = new BillingService({ clock: systemClock });
    const getQuotation = vi.fn(async () => 1415.25);
    const input = createBillingInput({ currencyCode: 'USD', exchangeRate: 1200 });

    await expect(service.resolveExchangeRate(input, { getQuotation })).resolves.toBe(input);
    expect(getQuotation).not.toHaveBeenCalled();
  });

  it('with --misma-moneda and a past date, asks ARCA for the rate of the business day before that date (10038)', async () => {
    const service = new BillingService({ clock: systemClock });
    const getQuotation = vi.fn(async () => 1410.5);
    const input = await service.resolveExchangeRate(
      createBillingInput({
        billingDate: '16/03/2026',
        currencyCode: 'USD',
        documentNumber: 0,
        exchangeRate: undefined,
        sameCurrency: true,
      }),
      { getQuotation },
    );
    const payload = service.buildVoucherPayload(input, createRuntime());

    expect(getQuotation).toHaveBeenCalledWith('DOL', '20260315');
    expect(payload).toMatchObject({ CanMisMonExt: 'S', CbteFch: '20260316', MonCotiz: 1410.5 });
  });

  it('with --misma-moneda and a future date, uses the current official rate (10038)', async () => {
    const service = new BillingService({ clock: systemClock });
    const getQuotation = vi.fn(async () => 1415.25);
    const input = await service.resolveExchangeRate(
      createBillingInput({
        billingDate: '19/03/2026',
        currencyCode: 'USD',
        documentNumber: 0,
        exchangeRate: undefined,
        sameCurrency: true,
      }),
      { getQuotation },
    );
    const payload = service.buildVoucherPayload(input, createRuntime());

    expect(getQuotation).toHaveBeenCalledWith('DOL');
    expect(payload).toMatchObject({ CanMisMonExt: 'S', CbteFch: '20260319', MonCotiz: 1415.25 });
  });

  it('without --misma-moneda, a past date still uses the current official rate as the default', async () => {
    const getQuotation = vi.fn(async () => 1415.25);

    await new BillingService({ clock: systemClock }).resolveExchangeRate(
      createBillingInput({
        billingDate: '16/03/2026',
        currencyCode: 'USD',
        documentNumber: 0,
        exchangeRate: undefined,
      }),
      { getQuotation },
    );

    expect(getQuotation).toHaveBeenCalledWith('DOL');
  });

  it('discriminates IVA in factura A for a monotributista', () => {
    const service = new BillingService({ clock: systemClock });

    const payload = service.buildVoucherPayload(
      createBillingInput({
        documentNumber: 20123456786,
        documentType: 'cuit',
        ivaCondition: 'responsable-monotributo',
        shortcut: 'fa',
        totalAmount: 121,
      }),
      createRuntime(),
    );

    expect(payload.ImpNeto).toBe(100);
    expect(payload.ImpIVA).toBe(21);
    expect(payload.Iva).toEqual([{ BaseImp: 100, Id: 5, Importe: 21 }]);
  });

  it('rejects receiver IVA conditions that ARCA does not accept for the voucher letter', () => {
    const service = new BillingService({ clock: systemClock });

    expect(() =>
      service.buildVoucherPayload(createBillingInput({ documentNumber: 0, shortcut: 'fa' }), createRuntime()),
    ).toThrow(/factura A no admite IVA receptor "consumidor-final". Usá un comprobante letra B/);
    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          documentNumber: 20123456786,
          documentType: 'cuit',
          ivaCondition: 'responsable-inscripto',
          shortcut: 'fb',
        }),
        createRuntime(),
      ),
    ).toThrow(/factura B no admite IVA receptor "responsable-inscripto". Usá un comprobante letra A/);
  });

  it('accepts any receiver IVA condition for letter C', () => {
    const service = new BillingService({ clock: systemClock });

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          documentNumber: 20123456786,
          documentType: 'cuit',
          ivaCondition: 'responsable-inscripto',
          shortcut: 'fc',
        }),
        createRuntime(),
      ),
    ).not.toThrow();
  });

  it('requires identifying the consumer final from $10.000.000', () => {
    const service = new BillingService({ clock: systemClock });

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({ documentNumber: 0, totalAmount: 9_999_999.99 }),
        createRuntime(),
      ),
    ).not.toThrow();
    expect(() =>
      service.buildVoucherPayload(createBillingInput({ documentNumber: 0, totalAmount: 10_000_000 }), createRuntime()),
    ).toThrow(/requiere identificar al consumidor final/);
    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({ documentNumber: 12345678, documentType: 'dni', totalAmount: 10_000_000 }),
        createRuntime(),
      ),
    ).not.toThrow();
  });

  it('converts foreign currency amounts to pesos for the consumer final threshold', () => {
    const service = new BillingService({ clock: systemClock });

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({ currencyCode: 'USD', documentNumber: 0, exchangeRate: 1000, totalAmount: 10_000 }),
        createRuntime(),
      ),
    ).toThrow(/requiere identificar al consumidor final/);
  });

  it('builds IVA automatically for factura A with responsable inscripto', () => {
    const service = new BillingService({ clock: systemClock });

    const payload = service.buildVoucherPayload(
      createBillingInput({
        documentNumber: 20123456786,
        documentType: 'cuit',
        ivaCondition: 'responsable-inscripto',
        shortcut: 'fa',
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
    const service = new BillingService({ clock: systemClock });

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
    const service = new BillingService({ clock: systemClock });

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
    const service = new BillingService({ clock: systemClock });

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
    const service = new BillingService({ clock: systemClock });

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
    const service = new BillingService({ clock: systemClock });

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          documentNumber: 2012345678,
          documentType: 'cuit',
          ivaCondition: 'responsable-inscripto',
        }),
        createRuntime(),
      ),
    ).toThrow(/`--cuit` 2012345678 no es válido .*: debe tener 11 dígitos/);
  });

  it('rejects a cuit or cuil with a wrong check digit', () => {
    const service = new BillingService({ clock: systemClock });

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          documentNumber: 20333333335,
          documentType: 'cuil',
          ivaCondition: 'responsable-inscripto',
        }),
        createRuntime(),
      ),
    ).toThrow(/`--cuil` 20333333335 no es válido .*dígito verificador/);
  });

  it('rejects dni with invalid length', () => {
    const service = new BillingService({ clock: systemClock });

    for (const documentNumber of [12345, 123456789]) {
      expect(() =>
        service.buildVoucherPayload(createBillingInput({ documentNumber, documentType: 'dni' }), createRuntime()),
      ).toThrow(/`--dni` debe tener de 6 a 8 dígitos/);
    }
  });

  it('accepts a 6-digit DNI, which ARCA testing approved', () => {
    const payload = new BillingService({ clock: systemClock }).buildVoucherPayload(
      createBillingInput({ documentNumber: 543210, documentType: 'dni' }),
      createRuntime(),
    );

    expect(payload).toMatchObject({ DocNro: 543210, DocTipo: 96 });
  });

  it('rejects service dates for products concept', () => {
    const service = new BillingService({ clock: systemClock });

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
    const service = new BillingService({ clock: systemClock });

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          billingDate: '18-03-2026',
          documentNumber: 0,
          serviceStartDate: '10-03-2026',
        }),
        createRuntime(),
      ),
    ).toThrow(/tenés que enviar ambas/);
  });

  it('rejects billing dates outside the ARCA window', () => {
    const service = new BillingService({ clock: systemClock });
    const build = (overrides: Partial<BillingCommandInput>) => () =>
      service.buildVoucherPayload(createBillingInput({ documentNumber: 0, ...overrides }), createRuntime());

    expect(build({ billingDate: '13/03/2026', concept: 'productos' })).not.toThrow();
    expect(build({ billingDate: '12/03/2026', concept: 'productos' })).toThrow(/hasta 5 días antes y 5 después/);
    expect(build({ billingDate: '08/03/2026' })).not.toThrow();
    expect(build({ billingDate: '07/03/2026' })).toThrow(/hasta 10 días antes y 10 después/);
    expect(build({ billingDate: '28/03/2026' })).not.toThrow();
    expect(build({ billingDate: '29/03/2026' })).toThrow(/hasta 10 días antes y 10 después/);
  });

  it('rejects future product dates in another month', () => {
    vi.setSystemTime(new Date('2026-03-30T12:00:00Z'));

    const service = new BillingService({ clock: systemClock });

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({ billingDate: '01/04/2026', concept: 'productos', documentNumber: 0 }),
        createRuntime(),
      ),
    ).toThrow(/futura y cae en otro mes/);
  });

  it('uses the FCE billing date window', () => {
    const service = new BillingService({ clock: systemClock });
    const build = (billingDate: string) => () =>
      service.buildVoucherPayload(
        createBillingInput({
          billingDate,
          documentNumber: 20123456786,
          documentType: 'cuit',
          cbu: '0110599520000012345678',
          ivaCondition: 'responsable-inscripto',
          shortcut: 'fcea',
        }),
        createRuntime(),
      );

    expect(build('19/03/2026')).not.toThrow();
    expect(build('20/03/2026')).toThrow(/hasta 5 días antes y 1 después/);
    expect(build('12/03/2026')).toThrow(/hasta 5 días antes y 1 después/);
  });

  it('sends FchVtoPago on FCE invoices even for products', () => {
    const service = new BillingService({ clock: systemClock });

    const payload = service.buildVoucherPayload(
      createBillingInput({
        billingDate: '16/03/2026',
        concept: 'productos',
        documentNumber: 20123456786,
        documentType: 'cuit',
        cbu: '0110599520000012345678',
        ivaCondition: 'responsable-inscripto',
        shortcut: 'fcea',
      }),
      createRuntime(),
    );

    expect(payload.FchServDesde).toBeUndefined();
    expect(payload.FchVtoPago).toBe('20260318');
  });

  it('rejects an FCE payment due date before today', () => {
    const service = new BillingService({ clock: systemClock });

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          billingDate: '16/03/2026',
          documentNumber: 20123456786,
          documentType: 'cuit',
          ivaCondition: 'responsable-inscripto',
          cbu: '0110599520000012345678',
          paymentDueDate: '17/03/2026',
          shortcut: 'fcea',
        }),
        createRuntime(),
      ),
    ).toThrow(/no puede ser anterior al 18\/03\/2026/);
  });

  it('does not send FchVtoPago on FCE credit or debit notes', () => {
    const service = new BillingService({ clock: systemClock });
    const input = createBillingInput({
      associatedVoucher: { cuit: '20409509763', fecha: '10/03/2026', numero: 1, puntoVenta: 3, shortcut: 'fcea' },
      documentNumber: 20123456786,
      documentType: 'cuit',
      ivaCondition: 'responsable-inscripto',
      shortcut: 'ncea',
    });

    expect(service.buildVoucherPayload(input, createRuntime()).FchVtoPago).toBeUndefined();
    expect(() => service.buildVoucherPayload({ ...input, paymentDueDate: '30/03/2026' }, createRuntime())).toThrow(
      /no lleva vencimiento de pago/,
    );
  });

  it('accepts an explicit payment due date independent from the service period', () => {
    const service = new BillingService({ clock: systemClock });

    const payload = service.buildVoucherPayload(
      createBillingInput({
        billingDate: '18/03/2026',
        documentNumber: 0,
        paymentDueDate: '10/04/2026',
        serviceEndDate: '28/02/2026',
        serviceStartDate: '01/02/2026',
      }),
      createRuntime(),
    );

    expect(payload.FchServHasta).toBe('20260228');
    expect(payload.FchVtoPago).toBe('20260410');
  });

  it('defaults the payment due date to the billing date when the service ended earlier', () => {
    const service = new BillingService({ clock: systemClock });

    const payload = service.buildVoucherPayload(
      createBillingInput({
        billingDate: '18/03/2026',
        documentNumber: 0,
        serviceEndDate: '28/02/2026',
        serviceStartDate: '01/02/2026',
      }),
      createRuntime(),
    );

    expect(payload.FchVtoPago).toBe('20260318');
  });

  it('rejects a payment due date before the billing date', () => {
    const service = new BillingService({ clock: systemClock });

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({ billingDate: '18/03/2026', documentNumber: 0, paymentDueDate: '17/03/2026' }),
        createRuntime(),
      ),
    ).toThrow(/no puede ser anterior al 18\/03\/2026/);
  });

  it('rejects --vencimiento on product invoices', () => {
    const service = new BillingService({ clock: systemClock });

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({ concept: 'productos', documentNumber: 0, paymentDueDate: '30/03/2026' }),
        createRuntime(),
      ),
    ).toThrow(/no usa `--vencimiento`/);
  });

  describe('periodo asociado', () => {
    const periodNote = (overrides: Partial<BillingCommandInput> = {}) =>
      createBillingInput({
        associatedPeriod: { desde: '01/02/2026', hasta: '28/02/2026' },
        billingDate: '18/03/2026',
        documentNumber: 0,
        shortcut: 'ncb',
        ...overrides,
      });

    it('lee el reloj una vez por operación: la medianoche no cae en el medio de un comprobante', () => {
      // La primera lectura es del 18/03; las que sigan, del 19/03.
      const now = vi.fn(() => new Date('2026-03-19T03:00:00Z')).mockReturnValueOnce(new Date('2026-03-19T02:59:59Z'));
      const service = new BillingService({ clock: { now } });
      const untilTomorrow = periodNote({
        associatedPeriod: { desde: '01/03/2026', hasta: '19/03/2026' },
        billingDate: undefined,
      });

      expect(now).not.toHaveBeenCalled();
      expect(() => service.buildVoucherPayload(untilTomorrow, createRuntime())).toThrow(/período asociado/);
      expect(now).toHaveBeenCalledTimes(1);
      expect(service.buildVoucherPayload(untilTomorrow, createRuntime())).toMatchObject({
        CbteFch: '20260319',
        PeriodoAsoc: { FchHasta: '20260319' },
      });
      expect(now).toHaveBeenCalledTimes(2);
    });

    it('sends PeriodoAsoc instead of CbtesAsoc on regular notes', () => {
      const payload = new BillingService({ clock: systemClock }).buildVoucherPayload(periodNote(), createRuntime());

      expect(payload.PeriodoAsoc).toEqual({ FchDesde: '20260201', FchHasta: '20260228' });
      expect(payload.CbtesAsoc).toBeUndefined();
    });

    it('requires both period dates', () => {
      expect(() =>
        new BillingService({ clock: systemClock }).buildVoucherPayload(
          periodNote({ associatedPeriod: { desde: '01/02/2026' } }),
          createRuntime(),
        ),
      ).toThrow(/requiere ambas fechas/);
    });

    it('rejects a period together with an associated voucher', () => {
      expect(() =>
        new BillingService({ clock: systemClock }).buildVoucherPayload(
          periodNote({ associatedVoucher: { cuit: '20123456786', numero: 1, puntoVenta: 3, shortcut: 'fb' } }),
          createRuntime(),
        ),
      ).toThrow(/pero no ambos/);
    });

    it('with a period and only part of an associated voucher, says not to mix them instead of asking for the voucher', () => {
      expect(() =>
        new BillingService({ clock: systemClock }).buildVoucherPayload(
          periodNote({ associatedVoucher: { cuit: '20123456786' } }),
          createRuntime(),
        ),
      ).toThrow(/pero no ambos/);
    });

    it('rejects a period ending after the note date', () => {
      expect(() =>
        new BillingService({ clock: systemClock }).buildVoucherPayload(
          periodNote({ associatedPeriod: { desde: '01/03/2026', hasta: '19/03/2026' } }),
          createRuntime(),
        ),
      ).toThrow(/no puede terminar después/);
    });

    it('rejects an inverted period', () => {
      expect(() =>
        new BillingService({ clock: systemClock }).buildVoucherPayload(
          periodNote({ associatedPeriod: { desde: '28/02/2026', hasta: '01/02/2026' } }),
          createRuntime(),
        ),
      ).toThrow(/no puede ser posterior/);
    });

    it('acepta los bordes del período: desde el 01/01/2006, desde = hasta y hasta = fecha de la nota (TEST-17)', () => {
      const period = (desde: string, hasta: string) =>
        new BillingService({ clock: systemClock }).buildVoucherPayload(
          periodNote({ associatedPeriod: { desde, hasta } }),
          createRuntime(),
        ).PeriodoAsoc;

      expect(period('01/01/2006', '31/01/2006')).toEqual({ FchDesde: '20060101', FchHasta: '20060131' });
      expect(period('10/03/2026', '10/03/2026')).toEqual({ FchDesde: '20260310', FchHasta: '20260310' });
      expect(period('01/03/2026', '18/03/2026')).toEqual({ FchDesde: '20260301', FchHasta: '20260318' });
      expect(() => period('31/12/2005', '31/01/2006')).toThrow(/posterior al 01\/01\/2006/);
    });

    it('rejects periods before 2006', () => {
      expect(() =>
        new BillingService({ clock: systemClock }).buildVoucherPayload(
          periodNote({ associatedPeriod: { desde: '01/12/2005', hasta: '31/12/2005' } }),
          createRuntime(),
        ),
      ).toThrow(/posterior al 01\/01\/2006/);
    });

    it('rejects a period on invoices and FCE notes', () => {
      const service = new BillingService({ clock: systemClock });

      expect(() => service.buildVoucherPayload(periodNote({ shortcut: 'fb' }), createRuntime())).toThrow(
        /no usa período asociado/,
      );
      expect(() =>
        service.buildVoucherPayload(
          periodNote({
            documentNumber: 30709965812,
            documentType: 'cuit',
            ivaCondition: 'responsable-inscripto',
            shortcut: 'ncea',
          }),
          createRuntime(),
        ),
      ).toThrow(/no admite período asociado/);
    });

    it('mentions the period alternative when a regular note has no association', () => {
      expect(() =>
        new BillingService({ clock: systemClock }).buildVoucherPayload(
          periodNote({ associatedPeriod: undefined }),
          createRuntime(),
        ),
      ).toThrow(/o un período con `--periodo-desde` y `--periodo-hasta`/);
    });
  });

  describe('resolveFceWarnings', () => {
    const rejectingGateway = {
      getObligation: async () => {
        throw new Error('El certificado no esta autorizado para el servicio wsfecred.');
      },
    };

    it('queries the receiver CUIT with the billing date and amount in pesos', async () => {
      const getObligation = vi.fn(async () => ({ minimumAmount: 3_958_316, obligated: true }));
      const warnings = await new BillingService({ clock: systemClock }).resolveFceWarnings(
        createBillingInput({
          billingDate: '15/03/2026',
          currencyCode: 'USD',
          documentNumber: 30709965812,
          documentType: 'cuit',
          exchangeRate: 1000,
          ivaCondition: 'responsable-inscripto',
          shortcut: 'fa',
          totalAmount: 5000,
        }),
        { getObligation },
      );

      expect(getObligation).toHaveBeenCalledWith(30709965812, '20260315');
      expect(warnings).toEqual([expect.stringContaining('Corresponde emitir fcea en lugar de fa')]);
    });

    it('skips vouchers that do not depend on the FCE regime', async () => {
      const getObligation = vi.fn();

      await expect(
        new BillingService({ clock: systemClock }).resolveFceWarnings(createBillingInput({ documentNumber: 0 }), {
          getObligation,
        }),
      ).resolves.toEqual([]);
      expect(getObligation).not.toHaveBeenCalled();
    });

    it('un error de archivo en el aviso va traducido', async () => {
      const failure = Object.assign(new Error("EACCES: permission denied, open '/Users/ana/x/y.json'"), {
        code: 'EACCES',
        path: '/Users/ana/x/y.json',
        syscall: 'open',
      });

      expect(
        await new BillingService({ clock: systemClock }).resolveFceWarnings(
          createBillingInput({
            documentNumber: 30709965812,
            documentType: 'cuit',
            ivaCondition: 'responsable-inscripto',
            shortcut: 'fa',
          }),
          { getObligation: () => Promise.reject(failure) },
        ),
      ).toEqual(['No se pudo verificar el régimen FCE del receptor: No se pudo abrir .../x/y.json: no tenés permiso.']);
    });

    it('turns query failures into a warning instead of blocking', async () => {
      const warnings = await new BillingService({ clock: systemClock }).resolveFceWarnings(
        createBillingInput({
          documentNumber: 30709965812,
          documentType: 'cuit',
          ivaCondition: 'responsable-inscripto',
          shortcut: 'fa',
        }),
        rejectingGateway,
      );

      expect(warnings).toEqual([
        'No se pudo verificar el régimen FCE del receptor: El certificado no esta autorizado para el servicio wsfecred.',
      ]);
    });
  });

  describe('factura de credito electronica', () => {
    const fceInvoice = (overrides: Partial<BillingCommandInput> = {}) =>
      createBillingInput({
        billingDate: '18/03/2026',
        cbu: '0110599520000012345678',
        documentNumber: 30709965812,
        documentType: 'cuit',
        ivaCondition: 'responsable-inscripto',
        shortcut: 'fcea',
        ...overrides,
      });
    const fceNote = (overrides: Partial<BillingCommandInput> = {}) =>
      createBillingInput({
        associatedVoucher: { fecha: '10/03/2026', numero: 7, puntoVenta: 3, shortcut: 'fcea' },
        billingDate: '18/03/2026',
        documentNumber: 30709965812,
        documentType: 'cuit',
        ivaCondition: 'responsable-inscripto',
        shortcut: 'ncea',
        ...overrides,
      });

    it('sends CBU and the default SCA transfer mode on FCE invoices', () => {
      const payload = new BillingService({ clock: systemClock }).buildVoucherPayload(fceInvoice(), createRuntime());

      expect(payload.Opcionales).toEqual([
        { Id: '2101', Valor: '0110599520000012345678' },
        { Id: '27', Valor: 'SCA' },
      ]);
    });

    it('sends the CBU alias and the chosen transfer mode', () => {
      const payload = new BillingService({ clock: systemClock }).buildVoucherPayload(
        fceInvoice({ cbuAlias: 'mi.alias.cbu', transferMode: 'adc' }),
        createRuntime(),
      );

      expect(payload.Opcionales).toEqual([
        { Id: '2101', Valor: '0110599520000012345678' },
        { Id: '2102', Valor: 'mi.alias.cbu' },
        { Id: '27', Valor: 'ADC' },
      ]);
    });

    it('requires the CBU on FCE invoices', () => {
      expect(() =>
        new BillingService({ clock: systemClock }).buildVoucherPayload(fceInvoice({ cbu: undefined }), createRuntime()),
      ).toThrow(/requiere el CBU del emisor/);
    });

    it('rejects --anulacion on FCE invoices', () => {
      expect(() =>
        new BillingService({ clock: systemClock }).buildVoucherPayload(
          fceInvoice({ cancellation: true }),
          createRuntime(),
        ),
      ).toThrow(/no usa `--anulacion`/);
    });

    it('sends the cancellation code, associated date and emitter CUIT on FCE notes', () => {
      const service = new BillingService({ clock: systemClock });
      const regular = service.buildVoucherPayload(fceNote(), createRuntime());
      const cancellation = service.buildVoucherPayload(fceNote({ cancellation: true }), createRuntime());

      expect(regular.Opcionales).toEqual([{ Id: '22', Valor: 'N' }]);
      expect(cancellation.Opcionales).toEqual([{ Id: '22', Valor: 'S' }]);
      expect(regular.CbtesAsoc).toEqual([{ CbteFch: '20260310', Cuit: '20409509763', Nro: 7, PtoVta: 3, Tipo: 201 }]);
    });

    describe('asociado segun la anulacion (10156, 10157, 10183, 10186, 10193)', () => {
      const over = (shortcut: 'ncea' | 'ndea', associated: string, cancellation: boolean) =>
        fceNote({
          associatedVoucher: { fecha: '10/03/2026', numero: 7, puntoVenta: 3, shortcut: associated },
          cancellation,
          shortcut,
        });

      it.each([
        ['ncea', 'fcea', false, 201],
        ['ndea', 'fcea', false, 201],
        ['ncea', 'fcea', true, 201],
        ['ncea', 'ndea', true, 202],
        ['ndea', 'ncea', true, 203],
      ] as const)('una %s sobre una %s con anulacion %s es valida', (shortcut, associated, cancellation, tipo) => {
        const payload = new BillingService({ clock: systemClock }).buildVoucherPayload(
          over(shortcut, associated, cancellation),
          createRuntime(),
        );

        expect(payload.CbtesAsoc).toEqual([expect.objectContaining({ Tipo: tipo })]);
      });

      it('sin --anulacion solo asocia la factura FCE, y sugiere sumarla si con ella vale', () => {
        expect(() =>
          new BillingService({ clock: systemClock }).buildVoucherPayload(over('ncea', 'ndea', false), createRuntime()),
        ).toThrow(
          expect.objectContaining({
            message:
              'La nota de crédito electrónica A sin `--anulacion` solo puede asociar una factura de crédito electrónica A, no la nota de débito electrónica A.',
            suggestion: 'Sumá `--anulacion` para asociar la nota de débito electrónica A.',
          }),
        );
      });

      it('con --anulacion una ND FCE solo asocia una NC FCE, no la factura', () => {
        expect(() =>
          new BillingService({ clock: systemClock }).buildVoucherPayload(over('ndea', 'fcea', true), createRuntime()),
        ).toThrow(
          expect.objectContaining({
            message:
              'La nota de débito electrónica A con `--anulacion` solo puede asociar una nota de crédito electrónica A, no la factura de crédito electrónica A.',
            suggestion: 'Sacá `--anulacion` para asociar la factura de crédito electrónica A.',
          }),
        );
      });

      it('una NC FCE nunca asocia otra NC FCE', () => {
        const run = (cancellation: boolean) => () =>
          new BillingService({ clock: systemClock }).buildVoucherPayload(
            over('ncea', 'ncea', cancellation),
            createRuntime(),
          );

        expect(run(false)).toThrow(expect.objectContaining({ suggestion: undefined }));
        expect(run(true)).toThrow(
          'La nota de crédito electrónica A con `--anulacion` solo puede asociar una factura de crédito electrónica A o una nota de débito electrónica A, no la nota de crédito electrónica A.',
        );
      });
    });

    it('rejects invoice-only optionals on FCE notes', () => {
      expect(() =>
        new BillingService({ clock: systemClock }).buildVoucherPayload(
          fceNote({ cbu: '0110599520000012345678' }),
          createRuntime(),
        ),
      ).toThrow(/no lleva `--cbu`/);
    });

    it('previews an FCE note without the associated date: it comes from ARCA when emitting', () => {
      const payload = new BillingService({ clock: systemClock }).buildVoucherPayload(
        fceNote({ associatedVoucher: { numero: 7, puntoVenta: 3, shortcut: 'fcea' } }),
        createRuntime(),
      );

      expect(payload.CbtesAsoc).toEqual([{ Cuit: '20409509763', Nro: 7, PtoVta: 3, Tipo: 201 }]);
    });

    it('never emits an FCE note without the associated date', async () => {
      const gateway = { createVoucher: vi.fn(), getNextVoucherNumber: vi.fn(), getQuotation: vi.fn() };

      await expect(
        new BillingService({ clock: systemClock }).execute({
          gateway,
          input: fceNote({
            associatedVoucher: { numero: 7, puntoVenta: 3, shortcut: 'fcea' },
            dryRun: false,
            emit: true,
          }),
          runtime: createRuntime(),
        }),
      ).rejects.toThrow(/requiere la fecha del comprobante asociado/);
      expect(gateway.getNextVoucherNumber).not.toHaveBeenCalled();
      expect(gateway.createVoucher).not.toHaveBeenCalled();
    });

    it('rejects an associated voucher date after the note date', () => {
      expect(() =>
        new BillingService({ clock: systemClock }).buildVoucherPayload(
          fceNote({ associatedVoucher: { fecha: '19/03/2026', numero: 7, puntoVenta: 3, shortcut: 'fcea' } }),
          createRuntime(),
        ),
      ).toThrow(/no puede ser posterior/);
    });

    it('rejects an associated CUIT different from the emitter on FCE notes', () => {
      expect(() =>
        new BillingService({ clock: systemClock }).buildVoucherPayload(
          fceNote({
            associatedVoucher: { cuit: '20999999999', fecha: '10/03/2026', numero: 7, puntoVenta: 3, shortcut: 'fcea' },
          }),
          createRuntime(),
        ),
      ).toThrow(/tiene que ser del CUIT emisor/);
    });

    it('rejects FCE optionals on regular vouchers', () => {
      expect(() =>
        new BillingService({ clock: systemClock }).buildVoucherPayload(
          createBillingInput({ billingDate: '18/03/2026', cbu: '0110599520000012345678', documentNumber: 0 }),
          createRuntime(),
        ),
      ).toThrow(/`--cbu` solo aplica a comprobantes de crédito electrónica/);
    });

    it('acepta un asociado con la misma fecha que la nota (TEST-17)', () => {
      const payload = new BillingService({ clock: systemClock }).buildVoucherPayload(
        createBillingInput({
          associatedVoucher: { cuit: '20123456786', fecha: '18/03/2026', numero: 7, puntoVenta: 3, shortcut: 'fb' },
          billingDate: '18/03/2026',
          documentNumber: 0,
          shortcut: 'ncb',
        }),
        createRuntime(),
      );

      expect(payload.CbtesAsoc?.[0]?.CbteFch).toBe('20260318');
    });

    it('keeps the associated date optional on regular credit notes', () => {
      const payload = new BillingService({ clock: systemClock }).buildVoucherPayload(
        createBillingInput({
          associatedVoucher: { cuit: '20123456786', fecha: '10/03/2026', numero: 7, puntoVenta: 3, shortcut: 'fb' },
          billingDate: '18/03/2026',
          documentNumber: 0,
          shortcut: 'ncb',
        }),
        createRuntime(),
      );

      expect(payload.CbtesAsoc?.[0]?.CbteFch).toBe('20260310');
      expect(payload.Opcionales).toBeUndefined();
    });
  });

  it('rejects invalid service date ranges', () => {
    const service = new BillingService({ clock: systemClock });

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
    const service = new BillingService({ clock: systemClock });

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          associatedVoucher: {
            cuit: '20123456786',
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
    const service = new BillingService({ clock: systemClock });

    expect(() =>
      service.buildVoucherPayload(
        createBillingInput({
          associatedVoucher: {
            cuit: '20123456786',
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

  it('validates a numeric --at like a shortcut: an NC A cannot point to a Factura B', () => {
    expect(() =>
      new BillingService({ clock: systemClock }).buildVoucherPayload(
        createBillingInput({
          associatedVoucher: { cuit: '20123456786', numero: 99, puntoVenta: 3, tipo: 6 },
          documentNumber: 20123456786,
          documentType: 'cuit',
          ivaCondition: 'responsable-inscripto',
          shortcut: 'nca',
        }),
        createRuntime(),
      ),
    ).toThrow(/misma letra/);
  });

  it('rejects a shortcut and a numeric type that do not match', () => {
    expect(() =>
      new BillingService({ clock: systemClock }).buildVoucherPayload(
        createBillingInput({
          associatedVoucher: { cuit: '20123456786', numero: 99, puntoVenta: 3, shortcut: 'fa', tipo: 6 },
          documentNumber: 20123456786,
          documentType: 'cuit',
          ivaCondition: 'responsable-inscripto',
          shortcut: 'nca',
        }),
        createRuntime(),
      ),
    ).toThrow(/El atajo "fa" es el tipo 1, no el 6/);
  });

  describe('notas sobre otras notas (NOTAS-1, regla 10040)', () => {
    const noteOver = (shortcut: BillingCommandInput['shortcut'], associated: string) =>
      createBillingInput({
        associatedVoucher: { cuit: '20123456786', numero: 99, puntoVenta: 3, shortcut: associated },
        documentNumber: 20123456786,
        documentType: 'cuit',
        ivaCondition: shortcut.endsWith('a') ? 'responsable-inscripto' : 'sujeto-exento',
        shortcut,
      });

    it.each([
      ['nca', 'nda', 2],
      ['nda', 'nca', 3],
      ['nca', 'nca', 3],
      ['ncb', 'ndb', 7],
      ['ndb', 'ncb', 8],
      ['ncc', 'ndc', 12],
      ['ndc', 'ncc', 13],
      ['ndc', 'ndc', 12],
      ['nca', 'ra', 4],
      ['nda', 'ra', 4],
      ['ncb', 'rb', 9],
      ['ndb', 'rb', 9],
    ] as const)('una %s puede asociar una %s de la misma letra', (shortcut, associated, tipo) => {
      const payload = new BillingService({ clock: systemClock }).buildVoucherPayload(
        noteOver(shortcut, associated),
        createRuntime(),
      );

      expect(payload.CbtesAsoc).toEqual([expect.objectContaining({ Nro: 99, Tipo: tipo })]);
    });

    it.each([
      ['nca', 'ndb'],
      ['ndb', 'ncc'],
      ['ncc', 'nda'],
      ['nca', 'rb'],
      ['ncb', 'rc'],
    ] as const)('una %s no asocia una %s de otra letra', (shortcut, associated) => {
      expect(() =>
        new BillingService({ clock: systemClock }).buildVoucherPayload(noteOver(shortcut, associated), createRuntime()),
      ).toThrow(/misma letra/);
    });

    it('una nota comun no asocia una nota FCE', () => {
      expect(() =>
        new BillingService({ clock: systemClock }).buildVoucherPayload(noteOver('nca', 'ndea'), createRuntime()),
      ).toThrow(/misma categoría electrónica/);
    });

    it('valida igual el asociado por codigo ARCA (--at)', () => {
      const payload = new BillingService({ clock: systemClock }).buildVoucherPayload(
        createBillingInput({
          associatedVoucher: { cuit: '20123456786', numero: 99, puntoVenta: 3, tipo: 12 },
          documentNumber: 0,
          shortcut: 'ncc',
        }),
        createRuntime(),
      );

      expect(payload.CbtesAsoc).toEqual([expect.objectContaining({ Tipo: 12 })]);
    });
  });

  it('accepts a recibo C as the associated voucher of a C note', () => {
    const payload = new BillingService({ clock: systemClock }).buildVoucherPayload(
      createBillingInput({
        associatedVoucher: { cuit: '20123456786', numero: 1, puntoVenta: 3, shortcut: 'rc' },
        documentNumber: 0,
        shortcut: 'ncc',
      }),
      createRuntime(),
    );

    expect(payload.CbtesAsoc).toEqual([expect.objectContaining({ Nro: 1, PtoVta: 3, Tipo: 15 })]);
  });

  it('builds a recibo A (4) with discriminated IVA, like the factura A, and rejects a consumidor final', () => {
    const service = new BillingService({ clock: systemClock });
    const payload = service.buildVoucherPayload(
      createBillingInput({
        documentNumber: 30709965812,
        documentType: 'cuit',
        ivaCondition: 'responsable-inscripto',
        shortcut: 'ra',
        totalAmount: 1210,
      }),
      createRuntime(),
    );

    expect(payload).toMatchObject({ CbteTipo: 4, ImpIVA: 210, ImpNeto: 1000, ImpTotal: 1210 });
    expect(payload.Iva).toEqual([{ BaseImp: 1000, Id: 5, Importe: 210 }]);
    expect(() => service.buildVoucherPayload(createBillingInput({ shortcut: 'ra' }), createRuntime())).toThrow(
      /consumidor-final/,
    );
  });

  it('builds a recibo B (9) for a consumidor final, with the IVA included like the factura B', () => {
    const payload = new BillingService({ clock: systemClock }).buildVoucherPayload(
      createBillingInput({ shortcut: 'rb', totalAmount: 1210 }),
      createRuntime(),
    );

    expect(payload).toMatchObject({ CbteTipo: 9, DocTipo: 99, ImpIVA: 210, ImpNeto: 1000, ImpTotal: 1210 });
  });

  it('returns the number it sent to ARCA with the emitted voucher', async () => {
    const createVoucher = vi.fn(async () =>
      billingAnswer({ cae: '76123456789012', caeFchVto: '20261103', response: {} }),
    );
    const result = await new BillingService({ clock: systemClock }).execute({
      gateway: { createVoucher, getNextVoucherNumber: async () => 125, getQuotation: async () => 1 },
      input: createBillingInput({ documentNumber: 0, dryRun: false, emit: true }),
      runtime: createRuntime(),
    });

    expect(result.voucherNumber).toBe(125);
    expect(createVoucher).toHaveBeenCalledWith(expect.objectContaining({ CbteDesde: 125, CbteHasta: 125 }));
  });

  it('returns a mapped dry-run response without calling the gateway', async () => {
    const service = new BillingService({ clock: systemClock });

    const result = await service.execute({
      gateway: {
        createVoucher: async () => {
          throw new Error('No debería ejecutarse en dry-run');
        },
        getNextVoucherNumber: async () => {
          throw new Error('No debería ejecutarse en dry-run');
        },
        getQuotation: async () => {
          throw new Error('No debería consultarse la cotización');
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

  describe('emisión segura (TEST-15): solo emite con dryRun false y emit true', () => {
    it.each([
      { dryRun: true, emit: false, emits: false },
      { dryRun: true, emit: true, emits: false },
      { dryRun: false, emit: false, emits: false },
      { dryRun: false, emit: true, emits: true },
    ])('dryRun $dryRun y emit $emit → emite: $emits', async ({ dryRun, emit, emits }) => {
      const createVoucher = vi.fn(async () =>
        billingAnswer({ cae: '76123456789012', caeFchVto: '20261103', response: {} }),
      );
      const getNextVoucherNumber = vi.fn(async () => 7);

      const result = await new BillingService({ clock: systemClock }).execute({
        gateway: { createVoucher, getNextVoucherNumber, getQuotation: async () => 1 },
        input: createBillingInput({ documentNumber: 0, dryRun, emit }),
        runtime: createRuntime(),
      });

      expect(result.dryRun).toBe(!emits);
      expect(createVoucher).toHaveBeenCalledTimes(emits ? 1 : 0);
      expect(getNextVoucherNumber).toHaveBeenCalledTimes(emits ? 1 : 0);
    });

    it('el schema deja emit y dryRun en false si no vienen', () => {
      const parsed = billingCommandSchema.parse({
        concept: 'servicios',
        ivaCondition: 'consumidor-final',
        shortcut: 'fb',
        totalAmount: 1000,
      });

      expect(parsed.emit).toBe(false);
      expect(parsed.dryRun).toBe(false);
    });
  });

  it('flags a failed createVoucher call as uncertain, because the voucher may have been issued', async () => {
    const service = new BillingService({ clock: systemClock });
    const run = service.execute({
      gateway: {
        createVoucher: async () => {
          throw new Error('socket hang up');
        },
        getNextVoucherNumber: async () => 42,
        getQuotation: async () => 1,
      },
      input: createBillingInput({ documentNumber: 0, dryRun: false, emit: true }),
      runtime: createRuntime(),
    });

    await expect(run).rejects.toBeInstanceOf(EmissionUncertainError);
    await expect(run).rejects.toThrow('No se pudo confirmar la emisión: socket hang up');
    await expect(run).rejects.toMatchObject({
      code: 'EMISSION_UNCERTAIN',
      suggestion: expect.stringContaining('arcli ultimos fb --pv 3 --testing'),
    });
  });

  it.each([
    ['an authentication (WSAA) failure', 'Certificado expirado'],
    ['a failure fetching the last voucher number', 'ARCA no disponible'],
  ])('does not flag %s as uncertain, because nothing was sent to ARCA', async (_case, message) => {
    const service = new BillingService({ clock: systemClock });
    const cause = new Error(message);
    const createVoucher = vi.fn();
    const run = service.execute({
      gateway: {
        createVoucher,
        getNextVoucherNumber: async () => {
          throw cause;
        },
        getQuotation: async () => 1,
      },
      input: createBillingInput({ documentNumber: 0, dryRun: false, emit: true }),
      runtime: createRuntime(),
    });

    await expect(run).rejects.toBe(cause);
    await expect(run).rejects.not.toBeInstanceOf(EmissionUncertainError);
    expect(createVoucher).not.toHaveBeenCalled();
  });

  it('emits the next voucher number with the same payload and maps the response', async () => {
    const service = new BillingService({ clock: systemClock });
    const arcaResult = {
      cae: '76123456789012',
      caeFchVto: '20261029',
      response: { FeDetResp: { FECAEDetResponse: [{ CbteDesde: 42, CbteHasta: 42, Resultado: 'A' }] } },
    };
    const getNextVoucherNumber = vi.fn(async () => 42);
    const createVoucher = vi.fn(async () => billingAnswer(arcaResult));
    const input = createBillingInput({ documentNumber: 0, dryRun: false, emit: true });
    const payload = service.buildVoucherPayload(input, createRuntime());

    const result = await service.execute({
      gateway: { createVoucher, getNextVoucherNumber, getQuotation: async () => 1 },
      input,
      runtime: createRuntime(),
    });

    expect(getNextVoucherNumber).toHaveBeenCalledWith(payload.PtoVta, payload.CbteTipo);
    expect(createVoucher).toHaveBeenCalledWith({ ...payload, CbteDesde: 42, CbteHasta: 42 });
    expect(result.dryRun).toBe(false);
    expect(result.payload).toEqual(payload);
    expect(result.response).toEqual(mapBillingResponse(await billingAnswer(arcaResult)));
  });

  describe('con la vista previa confirmada (ARQ-21)', () => {
    const emitted = createBillingInput({ documentNumber: 0, dryRun: false, emit: true });
    const gateway = () => ({
      createVoucher: vi.fn(async () => billingAnswer({ cae: '76123456789012', caeFchVto: '20261103', response: {} })),
      getNextVoucherNumber: vi.fn(async () => 42),
      getQuotation: async () => 1,
    });

    it('emite su payload más el número, sin armarlo de nuevo, y lo devuelve', async () => {
      const service = new BillingService({ clock: systemClock });
      const preview = await service.execute({
        gateway: gateway(),
        input: createBillingInput({ documentNumber: 0 }),
        runtime: createRuntime(),
      });
      const emission = gateway();

      vi.setSystemTime(new Date('2026-03-19T12:00:00Z'));
      const build = vi.spyOn(service, 'buildVoucherPayload');
      const result = await service.execute({ gateway: emission, input: emitted, preview, runtime: createRuntime() });

      expect(build).not.toHaveBeenCalled();
      expect(emission.getNextVoucherNumber).toHaveBeenCalledExactlyOnceWith(3, 6);
      expect(emission.createVoucher).toHaveBeenCalledExactlyOnceWith({
        ...preview.payload,
        CbteDesde: 42,
        CbteHasta: 42,
      });
      expect(result).toMatchObject({ dryRun: false, payload: { CbteFch: '20260318' }, voucherNumber: 42 });
    });

    it('sin pedir emitir, no emite', async () => {
      const service = new BillingService({ clock: systemClock });
      const input = createBillingInput({ documentNumber: 0 });
      const preview = await service.execute({ gateway: gateway(), input, runtime: createRuntime() });
      const emission = gateway();

      await expect(
        service.execute({ gateway: emission, input, preview, runtime: createRuntime() }),
      ).resolves.toMatchObject({ dryRun: true });
      expect(emission.createVoucher).not.toHaveBeenCalled();
    });

    it('una nota FCE sin la fecha del asociado sigue sin llegar a ARCA', async () => {
      const service = new BillingService({ clock: systemClock });
      const note = createBillingInput({
        associatedVoucher: { numero: 7, puntoVenta: 3, shortcut: 'fcea' },
        documentNumber: 30709965812,
        documentType: 'cuit',
        ivaCondition: 'responsable-inscripto',
        shortcut: 'ncea',
      });
      const preview = await service.execute({ gateway: gateway(), input: note, runtime: createRuntime() });
      const emission = gateway();

      await expect(
        service.execute({
          gateway: emission,
          input: { ...note, dryRun: false, emit: true },
          preview,
          runtime: createRuntime(),
        }),
      ).rejects.toThrow(/requiere la fecha del comprobante asociado/);
      expect(emission.getNextVoucherNumber).not.toHaveBeenCalled();
    });
  });

  it('maps the empty CAE of a rejected voucher to null', async () => {
    const summary = await emitWithBillingAnswer({
      cae: '',
      caeFchVto: '',
      response: { FeDetResp: { FECAEDetResponse: [{ Resultado: 'R' }] } },
    });

    expect(summary).toMatchObject({ cae: null, caeVencimiento: null, status: 'rechazado' });
  });

  it('suggests a web service point of sale when ARCA rejects it with code 10005', async () => {
    const summary = await emitWithBillingAnswer({
      cae: '',
      caeFchVto: '',
      response: {
        Errors: {
          Err: [{ Code: 10005, Msg: 'El punto de venta informado debe estar dado de alta y ser del tipo RECE.' }],
        },
      },
    });

    expect(summary.status).toBe('rechazado');
    expect(summary.suggestions).toEqual([expect.stringContaining('Factura en línea')]);
    expect(summary.suggestions[0]).toContain(POINT_OF_SALE_GUIDE_URL);
  });

  it('recognizes the point of sale rejection by its message when the code is missing', async () => {
    const summary = await emitWithBillingAnswer({
      cae: '',
      caeFchVto: '',
      response: {
        Errors: { Err: [{ Msg: 'El punto de venta informado debe estar dado de alta y ser del tipo RECE.' }] },
        FeDetResp: { FECAEDetResponse: [{ Resultado: 'R' }] },
      },
    });

    expect(summary.suggestions).toEqual([expect.stringContaining('arcli parametros puntos-venta')]);
  });

  it('does not suggest a point of sale fix for unrelated rejections', async () => {
    const summary = await emitWithBillingAnswer({
      cae: '',
      caeFchVto: '',
      response: {
        Errors: { Err: [{ Code: 10016, Msg: 'El número de comprobante no es el próximo a autorizar.' }] },
        FeDetResp: { FECAEDetResponse: [{ Resultado: 'R' }] },
      },
    });

    expect(summary.suggestions.join(' ')).not.toContain('Factura en línea');
  });

  it('maps ARCA responses into a stable summary', async () => {
    const summary = await emitWithBillingAnswer({
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
    });

    expect(summary).toMatchObject({
      cae: '12345678901234',
      caeVencimiento: '20260331',
      observacion: 'Observacion de prueba',
      resultado: 'A',
    });
    expect(summary.events).toHaveLength(1);
    expect(summary.errors).toHaveLength(1);
  });

  describe('receptor según la letra y la FCE (REGLAS-12)', () => {
    const build = (overrides: Partial<BillingCommandInput>) =>
      new BillingService({ clock: systemClock }).buildVoucherPayload(createBillingInput(overrides), createRuntime());

    it.each([
      ['fa', 'dni', 12345678],
      ['fa', 'cuil', 20333333334],
      ['ra', 'cuil', 20333333334],
      ['nca', 'dni', 12345678],
    ] as const)('frena %s con %s (ARCA 10013) y sugiere la B', (shortcut, documentType, documentNumber) => {
      expect(() =>
        build({
          associatedVoucher: shortcut === 'nca' ? { numero: 1, puntoVenta: 3, shortcut: 'fa' } : undefined,
          documentNumber,
          documentType,
          ivaCondition: 'responsable-monotributo',
          shortcut,
        }),
      ).toThrow(expect.objectContaining({ code: 'INPUT_VALIDATION_ERROR', message: expect.stringMatching(/10013/) }));
    });

    it('la sugerencia de la A con DNI apunta al comprobante B de la misma familia', () => {
      expect(() =>
        build({
          documentNumber: 12345678,
          documentType: 'dni',
          ivaCondition: 'responsable-monotributo',
          shortcut: 'ra',
        }),
      ).toThrow(
        expect.objectContaining({
          message: 'El recibo A solo se emite a un CUIT: ARCA rechaza un comprobante A con DNI (error 10013).',
          suggestion: 'Identificá al receptor con `--cuit` o, si no tiene CUIT, emití el comprobante B (`rb`).',
        }),
      );
    });

    it.each([
      ['fceb', 'consumidor-final', undefined, 'a consumidor final'],
      ['fceb', 'dni', 12345678, 'con DNI'],
      ['fcec', 'cuil', 20333333334, 'con CUIL'],
    ] as const)('frena %s a %s (ARCA 10015) y sugiere la común', (shortcut, documentType, documentNumber, what) => {
      expect(() =>
        build({
          cbu: '0110599520000012345678',
          documentNumber,
          documentType,
          ivaCondition: documentType === 'consumidor-final' ? 'consumidor-final' : 'sujeto-exento',
          shortcut,
        }),
      ).toThrow(
        expect.objectContaining({
          message: expect.stringContaining(`ARCA rechaza una FCE ${what} (error 10015)`),
          suggestion: expect.stringContaining(`(\`${shortcut.replace('ce', '')}\`)`),
        }),
      );
    });

    it('frena el receptor igual al emisor (ARCA 10069)', () => {
      expect(() =>
        build({ documentNumber: 20409509763, documentType: 'cuit', ivaCondition: 'sujeto-exento', shortcut: 'fb' }),
      ).toThrow(
        expect.objectContaining({
          message: 'El receptor no puede ser el mismo CUIT que emite (20409509763): ARCA lo rechaza (error 10069).',
        }),
      );
    });

    it('frena la B a un No Categorizado con importe gravado, que pide el tributo 13 (ARCA 10067)', () => {
      const uncategorized = {
        documentNumber: 23000000000,
        documentType: 'cuit',
        ivaCondition: 'sujeto-no-categorizado',
      } as const;

      expect(() => build({ ...uncategorized, shortcut: 'fb' })).toThrow(
        expect.objectContaining({
          message: expect.stringMatching(/No Categorizado .*tributo 13.*error 10067/),
          suggestion: expect.stringContaining('`--exento` o `--nogravado`'),
        }),
      );
      // Sin neto gravado ARCA no lo pide, y la C y el recibo B no estan en la regla.
      expect(build({ ...uncategorized, exemptAmount: 1000, shortcut: 'fb' }).ImpNeto).toBe(0);
      expect(() => build({ ...uncategorized, shortcut: 'fc' })).not.toThrow();
      expect(() => build({ ...uncategorized, shortcut: 'rb' })).not.toThrow();
    });
  });
});
