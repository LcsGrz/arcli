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

  it('vacia, hoy o despues vale; antes de la fecha del comprobante, no', () => {
    expect(validateExportPaymentDate(now)('')).toBe(true);
    expect(validateExportPaymentDate(now)('18/11/2026')).toBe(true);
    expect(validateExportPaymentDate(now)('30/11/2026')).toBe(true);
    expect(validateExportPaymentDate(now)('17/11/2026')).toMatch(/error 1674/);
  });
});
