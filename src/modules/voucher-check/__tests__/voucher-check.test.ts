import { describe, expect, it } from 'vitest';

import { VOUCHER_KIND_MAP } from '../../billing/voucher-kind-map';
import { VOUCHER_CHECK_RECEIVER_RULE } from '../voucher-check';

const CUIT = { documentNumber: '20111111112', documentType: 80 };
const CUIL = { documentNumber: '20111111112', documentType: 86 };
const DNI = { documentNumber: '11111111', documentType: 96 };

const check = (input: Parameters<typeof VOUCHER_CHECK_RECEIVER_RULE.check>[0]) =>
  VOUCHER_CHECK_RECEIVER_RULE.check(input, undefined);

describe('VOUCHER_CHECK_RECEIVER_RULE (WSCDC v0.4, observaciones 113 a 118)', () => {
  it.each(['fa', 'nca', 'ra', 'fcea', 'fceb', 'fcec', 'ndeb'] as const)(
    'en %s pide el CUIT del receptor',
    (shortcut) => {
      const voucherType = VOUCHER_KIND_MAP[shortcut].arcaType;

      expect(check({ receiver: null, totalInPesos: 1, voucherType })).toEqual({
        message: expect.stringContaining('`--cuit`'),
        question: expect.not.stringContaining('--'),
      });
      expect(check({ receiver: CUIT, totalInPesos: 1, voucherType })).toBeUndefined();
    },
  );

  it('el texto del asistente no nombra flags: dice qué documento no sirve', () => {
    expect(check({ receiver: DNI, totalInPesos: 1, voucherType: 206 })).toEqual({
      message:
        'La factura de crédito electrónica B se constata con el CUIT del receptor: usá `--cuit` en vez de `--dni`.',
      question: 'La factura de crédito electrónica B se constata con el CUIT del receptor, no con DNI.',
    });
  });

  it('en B y C comunes, solo más de $ 10.000.000 pide el documento', () => {
    expect(check({ receiver: null, totalInPesos: 10_000_000, voucherType: 6 })).toBeUndefined();
    expect(check({ receiver: null, totalInPesos: 10_000_000.01, voucherType: 15 })).toMatchObject({
      question: 'El recibo C de más de $ 10.000.000 se constata con el documento del receptor.',
    });
    expect(check({ receiver: DNI, totalInPesos: 20_000_000, voucherType: 11 })).toBeUndefined();
  });

  it.each([30, 31, 37, 38, 41, 49])(
    'el tipo %i, que el manual nombra con B y C, también lleva el tope',
    (voucherType) => {
      expect(check({ receiver: null, totalInPesos: 10_000_000.01, voucherType })).toMatchObject({
        question: `El comprobante tipo ${voucherType} de más de $ 10.000.000 se constata con el documento del receptor.`,
      });
    },
  );

  it('sin el importe en pesos (un QR en dólares sin cotización) no se controla el tope', () => {
    expect(check({ receiver: null, totalInPesos: null, voucherType: 6 })).toBeUndefined();
  });

  it.each([195, 196, 197])('un comprobante T (%i) no va con CUIL; sin receptor lo decide ARCA', (voucherType) => {
    expect(check({ receiver: CUIL, totalInPesos: 1, voucherType })).toEqual({
      message: expect.stringContaining('en vez de `--cuil`'),
      question: `El comprobante tipo ${voucherType} (turismo) va con CUIT, CI extranjera, pasaporte o DNI del receptor, no con CUIL.`,
    });
    expect(check({ receiver: DNI, totalInPesos: 1, voucherType })).toBeUndefined();
    expect(check({ receiver: null, totalInPesos: 1, voucherType })).toBeUndefined();
  });

  it('un tipo que el manual no nombra (la M) lo decide ARCA', () => {
    expect(check({ receiver: null, totalInPesos: 20_000_000, voucherType: 51 })).toBeUndefined();
  });
});
