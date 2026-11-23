import { describe, expect, it } from 'vitest';

import { EXPORT_ITEMS_TOTAL_RULE } from '../export.items';
import { EXPORT_EXCHANGE_RATE_RULE, EXPORT_VOUCHER_DATE_WINDOW_RULE } from '../export.mappers';
import { EXPORT_NOTE_AFTER_ASSOCIATED_RULE } from '../export.notes';
import { EXPORT_PAYMENT_DATE_RULE, EXPORT_RULES } from '../export.rules';
import { EXPORT_CREDIT_NOTE_KIND } from '../export.types';

const today = '20261118';

describe('reglas de la E (export.rules.ts)', () => {
  it('export-voucher-date-window (1500): de hoy - 5 a hoy + 5, y en servicios hasta el fin de mes', () => {
    expect(EXPORT_VOUCHER_DATE_WINDOW_RULE.check({ exportType: 1, voucherDate: '23/11/2026' }, { today })).toBe(
      undefined,
    );
    expect(EXPORT_VOUCHER_DATE_WINDOW_RULE.check({ exportType: 1, voucherDate: '24/11/2026' }, { today })).toBe(
      'La fecha del comprobante (24/11/2026) está fuera de lo que acepta ARCA: del 13/11/2026 al 23/11/2026, hasta 5 días antes o después de hoy (error 1500).',
    );
    expect(
      EXPORT_VOUCHER_DATE_WINDOW_RULE.check({ exportType: 2, voucherDate: '01/12/2026' }, { today: '20261128' }),
    ).toMatch(/en servicios, no después del fin de mes \(error 1500\)/);
    // Sin fecha, hoy; sin hoy, no corre.
    expect(EXPORT_VOUCHER_DATE_WINDOW_RULE.check({}, { today })).toBeUndefined();
    expect(EXPORT_VOUCHER_DATE_WINDOW_RULE.check({ voucherDate: '01/01/2020' }, {})).toBeUndefined();
  });

  it('export-payment-date (1674): en servicios y otros, no antes de la fecha del comprobante', () => {
    expect(
      EXPORT_PAYMENT_DATE_RULE.check(
        { exportType: 2, paymentDate: '15/11/2026', voucherDate: '15/11/2026' },
        { today },
      ),
    ).toBeUndefined();
    expect(
      EXPORT_PAYMENT_DATE_RULE.check(
        { exportType: 4, paymentDate: '14/11/2026', voucherDate: '15/11/2026' },
        { today },
      ),
    ).toEqual({
      message:
        'La fecha de pago (14/11/2026) no puede ser anterior a la del comprobante (15/11/2026): ARCA la rechaza (error 1674). Revisá `--fecha-pago`.',
      question:
        'La fecha de pago no puede ser anterior a la del comprobante (15/11/2026): ARCA la rechaza (error 1674).',
    });
    // Sin fecha del comprobante, hoy.
    expect(EXPORT_PAYMENT_DATE_RULE.check({ exportType: 2, paymentDate: '17/11/2026' }, { today })).toMatchObject({
      question:
        'La fecha de pago no puede ser anterior a la del comprobante (hoy): ARCA la rechaza (error 1674). Escribí una desde el 18/11/2026, o volvé y elegí una fecha del comprobante anterior en los opcionales.',
    });
    // Con la fecha del comprobante sin elegir todavia (el asistente, TUI-22), la mas temprana que acepta ARCA (hoy - 5);
    // la escrita sigue mandando.
    expect(
      EXPORT_PAYMENT_DATE_RULE.check(
        { exportType: 2, paymentDate: '13/11/2026' },
        { today, undecidedVoucherDate: true },
      ),
    ).toBeUndefined();
    expect(
      EXPORT_PAYMENT_DATE_RULE.check(
        { exportType: 2, paymentDate: '12/11/2026' },
        { today, undecidedVoucherDate: true },
      ),
    ).toMatchObject({ question: expect.stringMatching(/^La fecha de pago no puede ser anterior al 13\/11\/2026: /) });
    expect(
      EXPORT_PAYMENT_DATE_RULE.check(
        { exportType: 2, paymentDate: '14/11/2026', voucherDate: '15/11/2026' },
        { today, undecidedVoucherDate: true },
      ),
    ).toMatchObject({ question: expect.stringContaining('(15/11/2026)') });
    // En bienes y en las notas no va: no corre.
    expect(
      EXPORT_PAYMENT_DATE_RULE.check(
        { exportType: 1, paymentDate: '01/01/2026', voucherDate: '15/11/2026' },
        { today },
      ),
    ).toBeUndefined();
    expect(
      EXPORT_PAYMENT_DATE_RULE.check(
        { exportType: 2, paymentDate: '01/01/2026', voucherDate: '15/11/2026', voucherKind: EXPORT_CREDIT_NOTE_KIND },
        { today },
      ),
    ).toBeUndefined();
    // Fechas en blanco cuentan como sin escribir: sin fecha de pago no corre; sin fecha del comprobante, hoy.
    expect(
      EXPORT_PAYMENT_DATE_RULE.check({ exportType: 2, paymentDate: '  ', voucherDate: '15/11/2026' }, { today }),
    ).toBeUndefined();
    expect(
      EXPORT_PAYMENT_DATE_RULE.check({ exportType: 2, paymentDate: '17/11/2026', voucherDate: '  ' }, { today }),
    ).toMatchObject({ question: expect.stringContaining('(hoy)') });
    // Sin fecha del comprobante ni hoy no corre; con la fecha escrita, no hace falta hoy.
    expect(EXPORT_PAYMENT_DATE_RULE.check({ exportType: 2, paymentDate: '01/01/2026' }, {})).toBeUndefined();
    expect(
      EXPORT_PAYMENT_DATE_RULE.check({ exportType: 2, paymentDate: '14/11/2026', voucherDate: '15/11/2026' }, {}),
    ).toMatchObject({ question: expect.stringContaining('(15/11/2026)') });
    // Sin año, se completa desde hoy; sin hoy no se puede comparar.
    expect(
      EXPORT_PAYMENT_DATE_RULE.check({ exportType: 2, paymentDate: '1/12', voucherDate: '5/1' }, { today: '20270104' }),
    ).toMatchObject({ message: expect.stringContaining('(01/12/2026)') });
    expect(
      EXPORT_PAYMENT_DATE_RULE.check({ exportType: 2, paymentDate: '1/12', voucherDate: '5/1' }, {}),
    ).toBeUndefined();
    // Ilegible da error aunque falte hoy.
    expect(() =>
      EXPORT_PAYMENT_DATE_RULE.check({ exportType: 2, paymentDate: 'x', voucherDate: '15/11/2026' }, {}),
    ).toThrow('La fecha "x" no es válida');
    expect(() =>
      EXPORT_PAYMENT_DATE_RULE.check({ exportType: 2, paymentDate: '15/11/2026', voucherDate: '31/2/2026' }, {}),
    ).toThrow('La fecha "31/2/2026" no es válida');
  });

  it('export-note-after-associated: la nota no es anterior al comprobante que ajusta', () => {
    const associated = { date: '20261110', label: 'la factura de exportación E 00003-00000012' };
    const note = { voucherKind: EXPORT_CREDIT_NOTE_KIND };

    expect(
      EXPORT_NOTE_AFTER_ASSOCIATED_RULE.check({ ...note, voucherDate: '10/11/2026' }, { associated, today }),
    ).toBeUndefined();
    expect(EXPORT_NOTE_AFTER_ASSOCIATED_RULE.check({ ...note, voucherDate: '09/11/2026' }, { associated, today })).toBe(
      'La fecha de la nota de crédito de exportación E (09/11/2026) no puede ser anterior a la de la factura de exportación E 00003-00000012 (10/11/2026).',
    );
    // Sin fecha, hoy; sin asociado, no corre.
    expect(EXPORT_NOTE_AFTER_ASSOCIATED_RULE.check(note, { associated, today: '20261109' })).toMatch(/09\/11\/2026/);
    expect(EXPORT_NOTE_AFTER_ASSOCIATED_RULE.check({ ...note, voucherDate: '01/01/2020' }, { today })).toBeUndefined();
    // Sin año se completa desde hoy. Sin hoy: la completa se compara igual y la que le falta el año no corre.
    const check = (voucherDate: string, context: { readonly today?: string }) =>
      EXPORT_NOTE_AFTER_ASSOCIATED_RULE.check({ ...note, voucherDate }, { associated, ...context });

    expect(check('9/11', { today })).toMatch(/09\/11\/2026/);
    expect(check('09/11/2026', {})).toMatch(/09\/11\/2026/);
    expect(['9', '31', '9/11', '29/2'].map((date) => check(date, {}))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    // Ilegible da error, con hoy o sin hoy.
    for (const date of ['x', '32', '31/2', '30/2/2026']) {
      expect(() => check(date, {})).toThrow(`La fecha "${date}" no es válida`);
      expect(() => check(date, { today })).toThrow(`La fecha "${date}" no es válida`);
    }
  });

  it('export-items-total (1610): los items suman el monto, y en el asistente nombra el monto total', () => {
    const items = [
      { description: 'Uno', quantity: 3, unitPrice: 33.335 },
      { description: 'Dos', quantity: 1, unitPrice: 0.01 },
    ];

    // Cada renglon se redondea: 100,01 + 0,01.
    expect(EXPORT_ITEMS_TOTAL_RULE.check({ amount: 100.02, items }, {})).toBeUndefined();
    expect(EXPORT_ITEMS_TOTAL_RULE.check({ amount: 100, items }, {})).toEqual({
      message: 'La suma de los ítems (100,02) no coincide con `--monto` (100).',
      question: 'La suma de los ítems (100,02) no coincide con el monto total (100).',
    });
    expect(EXPORT_ITEMS_TOTAL_RULE.check({ amount: 100 }, {})).toBeUndefined();
  });

  it('export-exchange-rate (1600, 1602): en pesos 1, en moneda extranjera mayor a 0', () => {
    expect(EXPORT_EXCHANGE_RATE_RULE.check({ currencyCode: 'PES', exchangeRate: 1 }, {})).toBeUndefined();
    expect(EXPORT_EXCHANGE_RATE_RULE.check({ currencyCode: 'ARS', exchangeRate: 2 }, {})).toEqual({
      message: 'En pesos la cotización tiene que ser 1. Sacá `--cotizacion-moneda` o usá `--cm 1`.',
      question: 'En pesos la cotización tiene que ser 1.',
    });
    expect(EXPORT_EXCHANGE_RATE_RULE.check({ currencyCode: 'usd', exchangeRate: 0.5 }, {})).toBeUndefined();
    expect(EXPORT_EXCHANGE_RATE_RULE.check({ currencyCode: 'usd', exchangeRate: 0 }, {})).toBe(
      'La cotización de USD tiene que ser mayor a 0.',
    );
    // Sin moneda, dolares; sin cotizacion, la de ARCA.
    expect(EXPORT_EXCHANGE_RATE_RULE.check({ exchangeRate: -1 }, {})).toBe(
      'La cotización de DOL tiene que ser mayor a 0.',
    );
    expect(EXPORT_EXCHANGE_RATE_RULE.check({ currencyCode: 'PES' }, {})).toBeUndefined();
  });

  it('cada regla tiene un id unico y campos', () => {
    const ids = EXPORT_RULES.map((rule) => rule.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(EXPORT_RULES.every((rule) => rule.fields.length > 0)).toBe(true);
  });
});
