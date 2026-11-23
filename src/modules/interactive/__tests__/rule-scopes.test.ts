import { describe, expect, it } from 'vitest';

import { VOUCHER_KIND_MAP } from '../../billing/voucher-kind-map';
import { EXPORT_CREDIT_NOTE_KIND, type ExportIssuedVoucher } from '../../export/export.types';
import type { IssuedVoucher } from '../../vouchers/voucher-history';
import { advancedInputFields } from '../billing-optionals';
import { exportFinalize, type ExportFlowState, exportRuleScope } from '../export-input';
import {
  exportNoteFinalize,
  exportNoteRuleInput,
  exportNoteRuleScope,
  type ExportNoteState,
} from '../export-note-input';
import { exportRepeatFinalize, exportRepeatRuleScope, type ExportRepeatState } from '../export-repeat-input';
import { asksCopiedExempt } from '../invoice-copy';
import { billingRuleEnv, invoiceFinalize, invoiceRuleScope, type InvoiceState } from '../invoice-input';
import { noteFinalize, type NoteRuleEnv, noteRuleScope, noteRuleValidator, type NoteState } from '../note-input';

/**
 * Lo que las preguntas del asistente usan para correr las reglas (`BILLING_RULES`, `EXPORT_RULES`): la entrada que se
 * arma con lo respondido, su contexto y `finalize`. Vive en `modules`; `cli` solo lo llama desde las preguntas.
 */

const TODAY = '20261118';
const PESOS = { currencyCode: 'ARS', sameCurrency: false } as const;
const ENV = { config: {}, emitterCuit: 20111111112, today: TODAY };

const issued = (overrides: Partial<IssuedVoucher> = {}): IssuedVoucher => ({
  date: '20261110',
  documentNumber: 0,
  documentTypeCode: 99,
  ivaAmount: 21,
  netAmount: 100,
  number: 21,
  total: 121,
  ...overrides,
});

describe('A, B y C', () => {
  const invoice: InvoiceState = {
    advanced: PESOS,
    concept: 'servicios',
    documentType: 'consumidor-final',
    totalAmount: 1000,
    voucherKind: VOUCHER_KIND_MAP.fb,
  };

  it('billingRuleEnv toma la config, el CUIT emisor y hoy', () => {
    const config = { alicuotaPorDefecto: '21' as const };

    expect(billingRuleEnv({ config, cuit: 20111111112 }, new Date('2026-11-18T15:00:00Z'))).toEqual({
      config,
      emitterCuit: 20111111112,
      today: TODAY,
    });
  });

  it('invoiceRuleScope arma la entrada con lo respondido y lo que escribe la pregunta', () => {
    const scope = invoiceRuleScope(invoice, ENV);

    expect(scope.context).toEqual({ emitterCuit: 20111111112, today: TODAY, voucherKind: VOUCHER_KIND_MAP.fb });
    expect(scope.draft({ exemptAmount: 300 })).toMatchObject({ exemptAmount: 300, shortcut: 'fb', totalAmount: 1000 });
  });

  it('invoiceFinalize corre las reglas sobre la entrada final; con la E elegida no hay entrada', () => {
    const finalize = invoiceFinalize(() => ENV);

    expect(finalize(invoice)).toBeUndefined();
    expect(finalize({ ...invoice, advanced: { ...PESOS, exemptAmount: 800, untaxedAmount: 300 } })).toEqual({
      field: ['exemptAmount', 'untaxedAmount', 'totalAmount'],
      message: 'El importe exento más el no gravado no puede superar el monto total.',
    });
    expect(finalize({ ...invoice, advanced: { ...PESOS, exemptAmount: 2000 }, exported: true })).toBeUndefined();
    expect(finalize({ ...invoice, voucherKind: undefined })).toBeUndefined();
  });

  it('advancedInputFields deja afuera el documento del consumidor (va como el del receptor)', () => {
    expect(
      advancedInputFields({ ...PESOS, consumerDocumentNumber: 30123456, consumerDocumentType: 'dni', exemptAmount: 1 }),
    ).toEqual({ ...PESOS, exemptAmount: 1 });
  });

  it('asksCopiedExempt: en "Repetir" con otro monto, si el original tenia exento o no gravado (REV-70)', () => {
    const withExempt = issued({ exemptAmount: 300, total: 421 });

    expect(asksCopiedExempt({ original: withExempt, sameAmount: false, voucherKind: VOUCHER_KIND_MAP.fb })).toBe(true);
    expect(asksCopiedExempt({ original: withExempt, voucherKind: VOUCHER_KIND_MAP.fb })).toBe(true);
    expect(
      asksCopiedExempt({
        original: issued({ untaxedAmount: 10 }),
        sameAmount: false,
        voucherKind: VOUCHER_KIND_MAP.fb,
      }),
    ).toBe(true);
    expect(asksCopiedExempt({ original: withExempt, sameAmount: true, voucherKind: VOUCHER_KIND_MAP.fb })).toBe(false);
    expect(asksCopiedExempt({ original: issued(), sameAmount: false, voucherKind: VOUCHER_KIND_MAP.fb })).toBe(false);
    // En la C no hay exento que copiar; sin original o sin comprobante, tampoco.
    expect(asksCopiedExempt({ original: withExempt, sameAmount: false, voucherKind: VOUCHER_KIND_MAP.fc })).toBe(false);
    expect(asksCopiedExempt({ sameAmount: false, voucherKind: VOUCHER_KIND_MAP.fb })).toBe(false);
    expect(asksCopiedExempt({ original: withExempt, sameAmount: false })).toBe(false);
  });
});

describe('notas', () => {
  const NOTE_ENV: NoteRuleEnv = { config: {}, issuerCuit: 20111111112, pointOfSale: 3, today: TODAY };
  const periodNote: NoteState = {
    advanced: PESOS,
    concept: 'servicios',
    documentType: 'consumidor-final',
    invoiceKind: VOUCHER_KIND_MAP.fc,
    kind: 'credito',
    periodFrom: '01/11/2026',
    target: 'periodo',
    totalAmount: 100,
  };

  it('noteRuleScope: el contexto es el de la nota, no el de la factura', () => {
    expect(noteRuleScope(periodNote, NOTE_ENV).context).toEqual({
      emitterCuit: 20111111112,
      today: TODAY,
      voucherKind: VOUCHER_KIND_MAP.ncc,
    });
    expect(noteRuleScope({ ...periodNote, kind: 'debito' }, NOTE_ENV).context.voucherKind).toBe(VOUCHER_KIND_MAP.ndc);
    // Sin tipo, credito (como el menu por defecto).
    expect(noteRuleScope({ ...periodNote, kind: undefined }, NOTE_ENV).context.voucherKind).toBe(VOUCHER_KIND_MAP.ncc);
  });

  it('noteRuleValidator: antes de elegir la fecha de la nota, contra la mas tardia que acepta ARCA', () => {
    const validate = noteRuleValidator(
      () => NOTE_ENV,
      'associatedPeriod.hasta',
      () => true,
      (value) => ({ periodTo: value }),
    );

    expect(validate(periodNote)('28/11/2026')).toBe(true);
    expect(validate(periodNote)('29/11/2026')).toBe(
      'El período asociado no puede terminar después del 28/11/2026: es la fecha más tardía que ARCA acepta para la nota de crédito C.',
    );
    expect(validate(periodNote)('31/10/2026')).toBe(
      'En el período asociado, "Período desde" no puede ser posterior a "Período hasta".',
    );
    // Con la fecha ya elegida en los opcionales, contra esa.
    expect(validate({ ...periodNote, advanced: { ...PESOS, billingDate: '20/11/2026' } })('25/11/2026')).toBe(
      'El período asociado no puede terminar después de la fecha de la nota de crédito C (20/11/2026).',
    );
  });

  it('noteFinalize: contra la fecha de la nota (sin elegir, hoy); sin comprobante o con la E, no hay entrada', () => {
    const finalize = noteFinalize(() => NOTE_ENV);
    const late = { ...periodNote, periodTo: '25/11/2026' };

    expect(finalize({ ...periodNote, periodTo: '18/11/2026' })).toBeUndefined();
    expect(finalize(late)).toEqual({
      field: ['billingDate', 'associatedPeriod.hasta'],
      message: expect.stringContaining('"Fecha del comprobante" de los opcionales'),
    });
    expect(finalize({ ...late, advanced: { ...PESOS, billingDate: '25/11/2026' } })).toBeUndefined();
    expect(finalize({ ...late, exported: true })).toBeUndefined();
    expect(finalize({ ...late, invoiceKind: undefined })).toBeUndefined();
  });
});

describe('la E', () => {
  const EXPORT_ENV = { today: TODAY };
  const items = [{ description: 'Según detalle', quantity: 1, unit: 7, unitPrice: 1500 }];
  const invoice: ExportFlowState = { exportType: 2, items, options: {}, paymentDate: '17/11/2026' };

  it('exportRuleScope y exportFinalize: la factura con lo respondido, y hoy', () => {
    expect(exportRuleScope(invoice, EXPORT_ENV)).toMatchObject({ context: { today: TODAY } });
    expect(exportRuleScope(invoice, EXPORT_ENV).draft({ voucherDate: '16/11/2026' })).toMatchObject({
      amount: 1500,
      voucherDate: '16/11/2026',
    });
    expect(exportFinalize(() => EXPORT_ENV)(invoice)).toEqual({
      field: ['paymentDate', 'voucherDate'],
      message:
        'La fecha de pago no puede ser anterior a la del comprobante (hoy): ARCA la rechaza (error 1674). Escribí una desde el 18/11/2026, o volvé y elegí una fecha del comprobante anterior en los opcionales.',
    });
    expect(exportFinalize(() => EXPORT_ENV)({ ...invoice, paymentDate: undefined })).toBeUndefined();
  });

  it('exportRepeatRuleScope y exportRepeatFinalize: la factura copiada; sin copia todavia no hay entrada', () => {
    const repeat: ExportRepeatState = {
      copy: { exportType: 2 },
      country: { code: 212, name: 'ESTADOS UNIDOS' },
      items,
      paymentDate: '17/11/2026',
    };

    expect(exportRepeatRuleScope(repeat, EXPORT_ENV).draft({})).toMatchObject({ amount: 1500, exportType: 2 });
    expect(exportRepeatRuleScope(repeat, EXPORT_ENV).context).toEqual({ today: TODAY });
    expect(exportRepeatFinalize(() => EXPORT_ENV)(repeat)).toMatchObject({ field: ['paymentDate', 'voucherDate'] });
    expect(exportRepeatFinalize(() => EXPORT_ENV)({ ...repeat, copy: undefined })).toBeUndefined();
    expect(exportRepeatFinalize(() => EXPORT_ENV)({ ...repeat, country: undefined })).toBeUndefined();
  });

  it('la nota E: con lo del asociado que no se pregunta (tipo, moneda) y la fecha del asociado', () => {
    const associated = {
      activities: [],
      arcaType: 19,
      clientName: 'ACME LLC',
      currencyCode: 'DOL',
      date: '20261117',
      destinationCountry: 212,
      exchangeRate: 1000,
      exportType: 1,
      number: 7,
      pointOfSale: 4,
    } as unknown as ExportIssuedVoucher;
    const note: ExportNoteState = {
      invoice: associated,
      items: [{ description: 'Ajuste', quantity: 1, unit: 7, unitPrice: 100 }],
      options: { voucherDate: '16/11/2026' },
    };
    const env = { kind: 'credito' as const, today: TODAY };

    expect(exportNoteRuleInput(note, env)).toMatchObject({
      currencyCode: 'DOL',
      exportType: 1,
      voucherKind: EXPORT_CREDIT_NOTE_KIND,
    });
    expect(exportNoteRuleScope(note, env).context).toEqual({
      associated: { date: '20261117', label: 'la factura de exportación E 00004-00000007' },
      today: TODAY,
    });
    expect(exportNoteFinalize(() => env)(note)).toEqual({
      field: ['voucherDate'],
      message:
        'La fecha de la nota de crédito de exportación E (16/11/2026) no puede ser anterior a la de la factura de exportación E 00004-00000007 (17/11/2026).',
    });
    expect(exportNoteFinalize(() => env)({ ...note, options: {} })).toBeUndefined();
    expect(exportNoteFinalize(() => env)({ ...note, invoice: undefined })).toBeUndefined();
  });
});
