import { describe, expect, it } from 'vitest';

import { VOUCHER_KIND_MAP } from '../../billing/voucher-kind-map';
import type { IssuedVoucher } from '../../vouchers/voucher-history';
import {
  asksOwnNoteData,
  buildNoteInput,
  isPeriodNote,
  noteCurrency,
  type NoteInputEnv,
  noteReadAssociated,
  type NoteState,
  requiredNoteCancellation,
} from '../note-input';

const ENV: NoteInputEnv = { config: {}, issuerCuit: 20111111112, pointOfSale: 3 };
const PESOS = { currencyCode: 'ARS', sameCurrency: false } as const;

const invoice = (overrides: Partial<IssuedVoucher> = {}): IssuedVoucher => ({
  date: '20261110',
  documentNumber: 0,
  documentTypeCode: 99,
  ivaAmount: 21,
  netAmount: 100,
  number: 14,
  total: 121,
  ...overrides,
});

/** Una NC B sobre la factura B 3-14 de la lista, a consumidor final. */
const overInvoice = (overrides: Partial<NoteState> = {}): NoteState => ({
  advanced: PESOS,
  concept: 'servicios',
  documentType: 'consumidor-final',
  invoice: invoice(),
  invoiceKind: VOUCHER_KIND_MAP.fb,
  ivaCondition: 'consumidor-final',
  ivaRate: '21',
  kind: 'credito',
  target: 'factura',
  totalAmount: 60.5,
  ...overrides,
});

/** Una ND C por el mes pasado, a consumidor final. */
const overPeriod = (overrides: Partial<NoteState> = {}): NoteState => ({
  advanced: PESOS,
  concept: 'productos',
  documentType: 'consumidor-final',
  invoiceKind: VOUCHER_KIND_MAP.fc,
  ivaCondition: 'consumidor-final',
  kind: 'debito',
  periodFrom: '01/10/2026',
  periodTo: '31/10/2026',
  target: 'periodo',
  totalAmount: 100,
  ...overrides,
});

describe('buildNoteInput', () => {
  it('sobre una factura de la lista, el asociado es del emisor, con la fecha de la factura y el punto de venta del flujo', () => {
    expect(buildNoteInput(overInvoice(), ENV)).toMatchObject({
      associatedPeriod: undefined,
      associatedVoucher: { cuit: '20111111112', fecha: '10/11/2026', numero: 14, puntoVenta: 3, shortcut: 'fb' },
      cancellation: false,
      shortcut: 'ncb',
      totalAmount: 60.5,
    });
  });

  it('el punto de venta de la factura ingresada a mano le gana al del flujo', () => {
    expect(buildNoteInput(overInvoice({ invoicePointOfSale: 7 }), ENV).associatedVoucher?.puntoVenta).toBe(7);
  });

  it('el asociado ya leído es el de la entrada: el punto de venta del comprobante le gana al de la sesión', () => {
    const state = overInvoice({ invoicePointOfSale: 7 });

    expect(noteReadAssociated(state, ENV)).toEqual({
      arcaType: state.invoiceKind?.arcaType,
      number: 14,
      pointOfSale: 7,
      voucher: state.invoice,
    });
    expect(noteReadAssociated(overInvoice(), ENV)).toMatchObject({ pointOfSale: 3 });
  });

  it('por período no hay asociado leído, aunque haya quedado un comprobante elegido', () => {
    expect(noteReadAssociated(overPeriod({ invoice: invoice() }), ENV)).toBeUndefined();
    expect(noteReadAssociated(overInvoice({ invoice: undefined }), ENV)).toBeUndefined();
    expect(noteReadAssociated(overInvoice({ invoiceKind: undefined }), ENV)).toBeUndefined();
  });

  it('por período: el período, sin asociado, y la moneda de los opcionales', () => {
    const input = buildNoteInput(
      overPeriod({ advanced: { currencyCode: 'USD', exchangeRate: 1400, sameCurrency: false } }),
      ENV,
    );

    expect(input).toMatchObject({
      associatedPeriod: { desde: '01/10/2026', hasta: '31/10/2026' },
      associatedVoucher: undefined,
      currencyCode: 'USD',
      exchangeRate: 1400,
      shortcut: 'ndc',
    });
  });

  it('sobre una de otro sistema: su número, su punto de venta y la fecha escrita', () => {
    const input = buildNoteInput(
      overInvoice({
        associatedDate: '05/11/2026',
        invoice: undefined,
        invoiceKind: VOUCHER_KIND_MAP.fc,
        otherSystemInvoice: { number: 15, origin: 'other', otherSystem: true, pointOfSale: 50 },
      }),
      ENV,
    );

    expect(input.associatedVoucher).toEqual({
      cuit: '20111111112',
      fecha: '05/11/2026',
      numero: 15,
      puntoVenta: 50,
      shortcut: 'fc',
    });
  });

  it('sin factura ni período, no hay asociado', () => {
    expect(buildNoteInput(overInvoice({ invoice: undefined }), ENV).associatedVoucher).toBeUndefined();
  });

  it('si anula el total copia exento y no gravado de la factura; si no, van los de los opcionales', () => {
    const withAmounts = overInvoice({
      advanced: { ...PESOS, exemptAmount: 5, untaxedAmount: 3 },
      invoice: invoice({ exemptAmount: 10, untaxedAmount: 20 }),
    });

    expect(buildNoteInput({ ...withAmounts, annulsTotal: true }, ENV)).toMatchObject({
      exemptAmount: 10,
      untaxedAmount: 20,
    });
    expect(buildNoteInput(withAmounts, ENV)).toMatchObject({ exemptAmount: 5, untaxedAmount: 3 });
  });

  it('pasa las fechas de los opcionales', () => {
    const input = buildNoteInput(
      overInvoice({
        advanced: {
          ...PESOS,
          billingDate: '17/11/2026',
          paymentDueDate: '25/11/2026',
          serviceEndDate: '15/11/2026',
          serviceStartDate: '01/11/2026',
        },
      }),
      ENV,
    );

    expect(input).toMatchObject({
      billingDate: '17/11/2026',
      paymentDueDate: '25/11/2026',
      serviceEndDate: '15/11/2026',
      serviceStartDate: '01/11/2026',
    });
  });

  it('sin opcionales cargados arranca en la moneda de la config, con su cotización marcada como de la config', () => {
    const input = buildNoteInput(overPeriod({ advanced: undefined }), {
      ...ENV,
      config: { cotizacionPorDefecto: 1400, monedaPorDefecto: 'USD' },
    });

    expect(input).toMatchObject({ currencyCode: 'USD', exchangeRate: 1400, exchangeRateSource: 'config' });
  });

  it('la alícuota: 21% sin config no se escribe, otra sí', () => {
    expect(buildNoteInput(overInvoice(), ENV).ivaRate).toBeUndefined();
    expect(buildNoteInput(overInvoice({ ivaRate: '10.5' }), ENV).ivaRate).toBe('10.5');
  });

  it('la anulación: la elegida en una NC FCE sobre la factura, y la que exige el asociado en las demás', () => {
    const fce = overInvoice({
      documentNumber: 30709965812,
      documentType: 'cuit',
      invoiceKind: VOUCHER_KIND_MAP.fcea,
      ivaCondition: 'responsable-inscripto',
    });

    expect(buildNoteInput({ ...fce, cancellation: true }, ENV)).toMatchObject({ cancellation: true, shortcut: 'ncea' });
    expect(buildNoteInput(fce, ENV).cancellation).toBe(false);
    // Una ND FCE sobre la factura nunca es de anulación; una nota sobre otra nota FCE, siempre.
    expect(buildNoteInput({ ...fce, cancellation: true, kind: 'debito' }, ENV).cancellation).toBe(false);
    expect(buildNoteInput({ ...fce, invoiceKind: VOUCHER_KIND_MAP.ndea }, ENV).cancellation).toBe(true);
  });

  it('sin el tipo de nota elegido, es de crédito', () => {
    expect(buildNoteInput(overInvoice({ kind: undefined }), ENV).shortcut).toBe('ncb');
  });

  it('"anular el total" sin factura de donde copiar no inventa exento ni no gravado', () => {
    const input = buildNoteInput(
      overPeriod({ advanced: { ...PESOS, exemptAmount: 5, untaxedAmount: 3 }, annulsTotal: true }),
      ENV,
    );

    expect(input.exemptAmount).toBeUndefined();
    expect(input.untaxedAmount).toBeUndefined();
  });

  it('sin el tipo del asociado, el flujo está mal armado', () => {
    expect(() => buildNoteInput(overInvoice({ invoiceKind: undefined }), ENV)).toThrow(/invoiceKind/);
  });
});

describe('noteCurrency', () => {
  it('sobre una factura en dólares, la suya; en pesos, pesos sin cotización', () => {
    const dollars = overInvoice({ invoice: invoice({ currency: 'DOL', exchangeRate: 1450 }) });

    expect(noteCurrency(dollars, PESOS)).toEqual({ currencyCode: 'DOL', exchangeRate: 1450 });
    expect(noteCurrency({ ...dollars, currency: 'pesos' }, PESOS)).toEqual({
      currencyCode: 'PES',
      exchangeRate: undefined,
    });
  });

  it('por período o de otro sistema, la de los opcionales, con de dónde salió la cotización', () => {
    const advanced = {
      currencyCode: 'USD',
      exchangeRate: 1400,
      exchangeRateSource: 'config',
      sameCurrency: false,
    } as const;

    expect(noteCurrency(overPeriod(), advanced)).toEqual(advanced);
  });
});

describe('isPeriodNote, asksOwnNoteData y requiredNoteCancellation', () => {
  it('por período y de otro sistema se preguntan los datos propios; sobre una factura de la lista, no', () => {
    const other = { number: 1, origin: 'other', otherSystem: true, pointOfSale: 50 } as const;

    expect(isPeriodNote({ target: 'periodo' })).toBe(true);
    expect(isPeriodNote({ target: 'factura' })).toBe(false);
    expect(asksOwnNoteData({ target: 'periodo' })).toBe(true);
    expect(asksOwnNoteData({ otherSystemInvoice: other, target: 'factura' })).toBe(true);
    expect(asksOwnNoteData({ target: 'factura' })).toBe(false);
  });

  it('solo en FCE la exige el asociado; en una NC FCE sobre la factura se elige', () => {
    expect(requiredNoteCancellation({ kind: 'credito' })).toBeUndefined();
    expect(requiredNoteCancellation({ invoiceKind: VOUCHER_KIND_MAP.fb, kind: 'credito' })).toBeUndefined();
    expect(requiredNoteCancellation({ invoiceKind: VOUCHER_KIND_MAP.fcea, kind: 'credito' })).toBeUndefined();
    expect(requiredNoteCancellation({ invoiceKind: VOUCHER_KIND_MAP.fcea })).toBeUndefined();
    expect(requiredNoteCancellation({ invoiceKind: VOUCHER_KIND_MAP.fcea, kind: 'debito' })).toBe(false);
    expect(requiredNoteCancellation({ invoiceKind: VOUCHER_KIND_MAP.ndea, kind: 'credito' })).toBe(true);
    expect(requiredNoteCancellation({ invoiceKind: VOUCHER_KIND_MAP.ncea, kind: 'debito' })).toBe(true);
  });
});
