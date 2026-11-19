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

  it('sin fecha del comprobante, contra hoy: vacia, hoy o despues vale; antes, no', () => {
    expect(validateExportPaymentDate(undefined, now)('')).toBe(true);
    expect(validateExportPaymentDate(undefined, now)('18/11/2026')).toBe(true);
    expect(validateExportPaymentDate(undefined, now)('30/11/2026')).toBe(true);
    expect(validateExportPaymentDate(undefined, now)('17/11/2026')).toMatch(/del comprobante \(hoy\).*error 1674/);
  });

  it('con la fecha del comprobante elegida, contra esa: anterior a hoy vale si no es anterior a ella (EXPO-12)', () => {
    expect(validateExportPaymentDate('15/11/2026', now)('15/11/2026')).toBe(true);
    expect(validateExportPaymentDate('15/11/2026', now)('16/11/2026')).toBe(true);
    expect(validateExportPaymentDate('15/11/2026', now)('14/11/2026')).toMatch(
      /del comprobante \(15\/11\/2026\).*error 1674/,
    );
    expect(validateExportPaymentDate('20/11/2026', now)('19/11/2026')).toMatch(/error 1674/);
  });
});
