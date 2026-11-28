import { describe, expect, it } from 'vitest';

import { findRuleFailure } from '../../../lib/rules/rules';
import { VOUCHER_CHECK_RECEIVER_RULES } from '../voucher-check';

const CUIT = { documentNumber: '20111111112', documentType: 80 };
const CUIL = { documentNumber: '20111111112', documentType: 86 };
const DNI = { documentNumber: '11111111', documentType: 96 };

type RuleInput = Parameters<(typeof VOUCHER_CHECK_RECEIVER_RULES)[number]['check']>[0];

/** La primera regla que falla, como en el CLI (`assertRules`). */
const check = (input: RuleInput) => findRuleFailure(VOUCHER_CHECK_RECEIVER_RULES, input, undefined)?.failure;

const ruleById = (id: string) => VOUCHER_CHECK_RECEIVER_RULES.find((rule) => rule.id === id)!;

describe('VOUCHER_CHECK_RECEIVER_RULES (WSCDC v0.4, observaciones 113 a 118)', () => {
  // Clase A, A con leyenda "Operación sujeta a retención" (51 a 54; no son la M) y FCE: tabla de tipos de WSFE.
  it.each([1, 2, 3, 4, 5, 34, 39, 60, 63, 51, 52, 53, 54, 201, 202, 203, 206, 207, 208, 211, 212, 213])(
    'el tipo %i pide el CUIT del receptor',
    (voucherType) => {
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

  it('el receptor que todavía no se preguntó (sin definir) no falla: el CLI pasa null', () => {
    expect(check({ totalInPesos: 1, voucherType: 1 })).toBeUndefined();
    expect(check({ totalInPesos: 20_000_000, voucherType: 6 })).toBeUndefined();
  });

  it('el CUIT y la T leen solo el receptor; el tope, el receptor y el importe', () => {
    expect(ruleById('voucher-check-receiver-document').fields).toEqual(['receiver']);
    expect(ruleById('voucher-check-receiver-threshold').fields).toEqual(['receiver', 'totalInPesos']);
  });

  it.each([6, 7, 8, 9, 10, 35, 40, 61, 64, 11, 12, 13, 15, 30, 31, 37, 38, 41, 49])(
    'el tipo %i pide el documento solo si el importe supera $ 10.000.000',
    (voucherType) => {
      expect(check({ receiver: null, totalInPesos: 10_000_000, voucherType })).toBeUndefined();
      expect(check({ receiver: null, totalInPesos: 10_000_000.01, voucherType })).toMatchObject({
        question: expect.stringContaining('de más de $ 10.000.000 se constata con el documento del receptor.'),
      });
      expect(check({ receiver: DNI, totalInPesos: 20_000_000, voucherType })).toBeUndefined();
    },
  );

  it('nombra el comprobante: el que ARCLI emite por su nombre y el otro por su código', () => {
    expect(check({ receiver: null, totalInPesos: 20_000_000, voucherType: 15 })).toMatchObject({
      question: 'El recibo C de más de $ 10.000.000 se constata con el documento del receptor.',
    });
    expect(check({ receiver: null, totalInPesos: 20_000_000, voucherType: 49 })).toMatchObject({
      question: 'El comprobante tipo 49 de más de $ 10.000.000 se constata con el documento del receptor.',
    });
  });

  it('sin el importe en pesos (un QR en otra moneda) el tope lo controla ARCA', () => {
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

  it.each([19, 99, 999])('un tipo que la tabla no clasifica (%i) lo decide ARCA', (voucherType) => {
    expect(check({ receiver: null, totalInPesos: 20_000_000, voucherType })).toBeUndefined();
  });
});
