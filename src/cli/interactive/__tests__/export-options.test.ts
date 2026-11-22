import { describe, expect, it } from 'vitest';

import { validateExportPaymentDate, validateExportText } from '../export-options';

describe('validateExportText', () => {
  it('controla el largo de ARCA y, si es obligatorio, que no este vacio', () => {
    expect(validateExportText('clientName', 'El cliente')('')).toBe('El cliente es obligatorio.');
    expect(validateExportText('clientName', 'El cliente')('ACME LLC')).toBe(true);
    expect(validateExportText('clientName')('a'.repeat(201))).toMatch(/200 caracteres.*error 1651/);
    expect(validateExportText('incotermDescription')('a'.repeat(21))).toMatch(/error 1642/);
    expect(validateExportText('paymentTerms')('')).toBe(true);
  });
});

describe('validateExportPaymentDate (1674)', () => {
  const now = new Date('2026-11-18T15:00:00Z');

  // TUI-22: se pregunta antes de los opcionales, donde se elige la fecha del comprobante.
  it('sin fecha del comprobante todavia, contra la mas temprana que acepta ARCA (hoy - 5): antes de esa, no', () => {
    const undecided = validateExportPaymentDate(undefined, { now });

    expect(undecided('')).toBe(true);
    expect(undecided('13/11/2026')).toBe(true);
    expect(undecided('30/11/2026')).toBe(true);
    expect(undecided('12/11/2026')).toBe(
      'La fecha de pago no puede ser anterior al 13/11/2026: es la fecha más temprana que ARCA acepta para el comprobante, y un pago anterior a él lo rechaza (error 1674).',
    );
  });

  it('de vuelta desde `finalize`, sin fecha del comprobante elegida, contra hoy: antes, no', () => {
    const today = validateExportPaymentDate(undefined, { now, undecided: false });

    expect(today('18/11/2026')).toBe(true);
    expect(today('17/11/2026')).toMatch(/del comprobante \(hoy\).*error 1674/);
  });

  it('con la fecha del comprobante elegida, contra esa: anterior a hoy vale si no es anterior a ella (EXPO-12)', () => {
    expect(validateExportPaymentDate('15/11/2026', { now })('15/11/2026')).toBe(true);
    expect(validateExportPaymentDate('15/11/2026', { now })('16/11/2026')).toBe(true);
    expect(validateExportPaymentDate('15/11/2026', { now })('14/11/2026')).toMatch(
      /del comprobante \(15\/11\/2026\).*error 1674/,
    );
    expect(validateExportPaymentDate('20/11/2026', { now })('19/11/2026')).toMatch(/error 1674/);
  });
});
