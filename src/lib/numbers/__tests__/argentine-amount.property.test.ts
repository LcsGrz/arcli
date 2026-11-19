import Big from 'big.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  formatArgentineAmount,
  formatArgentineAmountInput,
  formatArgentineMoney,
  formatExchangeRate,
  hasAtMostDecimals,
  parseArgentineAmount,
  roundToCents,
} from '../argentine-amount';
import { parseDocumentNumber, parseStrictInteger } from '../strict-integer';

/** Importes en centavos hasta el mayor que un double representa exacto: de 0,01 a ~90 billones. */
const cents = fc.integer({ max: Number.MAX_SAFE_INTEGER, min: 1 });
const amount = cents.map((value) => new Big(value).div(100).toNumber());

describe('parseArgentineAmount (propiedades)', () => {
  it('lee lo que escribe formatArgentineAmountInput (el valor del modo interactivo)', () => {
    fc.assert(
      fc.property(amount, (value) => {
        expect(parseArgentineAmount(formatArgentineAmountInput(value))).toEqual({ ok: true, value });
      }),
    );
  });

  it('lee lo que muestra formatArgentineAmount y formatArgentineMoney', () => {
    fc.assert(
      fc.property(amount, (value) => {
        expect(parseArgentineAmount(formatArgentineAmount(value))).toEqual({ ok: true, value });
        expect(parseArgentineAmount(formatArgentineMoney(value))).toEqual({ ok: true, value });
      }),
    );
  });

  it('cualquier texto da ok o un motivo, nunca una excepción, y lo aceptado es positivo y con hasta 2 decimales', () => {
    const amountLike = fc.stringMatching(/^\s?\$?\s?[\d.,]{0,24}\s?$/);

    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.string({ unit: 'grapheme' }), amountLike), (raw) => {
        const result = parseArgentineAmount(raw);

        if (result.ok) {
          expect(result.value).toBeGreaterThan(0);
          expect(Number.isFinite(result.value)).toBe(true);
          expect(hasAtMostDecimals(result.value, 2)).toBe(true);
        } else {
          expect(result.reason).toEqual(expect.any(String));
        }
      }),
      { numRuns: 300 },
    );
  });

  it('un negativo, el cero o un número con punto decimal nunca pasan', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true }), (value) => {
        const raw = String(value);
        const result = parseArgentineAmount(raw);

        if (value <= 0 || raw.includes('e') || /\.\d{1,2}$/.test(raw)) {
          expect(result.ok).toBe(false);
        }
      }),
    );
  });

  it('con maxDecimals N acepta hasta N decimales y rechaza N+1', () => {
    fc.assert(
      fc.property(fc.integer({ max: 6, min: 0 }), fc.integer({ max: 999_999, min: 1 }), (decimals, integer) => {
        const accepted = `${integer},${'5'.repeat(decimals)}`;
        const rejected = `${integer},${'5'.repeat(decimals + 1)}`;

        expect(parseArgentineAmount(accepted, { maxDecimals: decimals }).ok).toBe(decimals > 0);
        expect(parseArgentineAmount(rejected, { maxDecimals: decimals }).ok).toBe(false);
      }),
    );
  });
});

describe('roundToCents y hasAtMostDecimals (propiedades)', () => {
  it('redondear a centavos es idempotente y deja hasta 2 decimales', () => {
    fc.assert(
      fc.property(fc.double({ max: 1e12, min: -1e12, noNaN: true }), (value) => {
        const rounded = roundToCents(value);

        expect(roundToCents(rounded)).toBe(rounded);
        expect(hasAtMostDecimals(rounded, 2)).toBe(true);
        expect(Math.abs(rounded - value)).toBeLessThanOrEqual(0.005 + 1e-9);
      }),
    );
  });

  it('es simétrico: roundToCents(-x) = -roundToCents(x)', () => {
    fc.assert(
      fc.property(fc.double({ max: 1e12, min: 0, noNaN: true }), (value) => {
        // Con `===`: el 0 y el -0 cuentan igual.
        expect(roundToCents(-value) === -roundToCents(value)).toBe(true);
      }),
    );
  });
});

describe('formatos para mostrar (propiedades)', () => {
  it('formatArgentineAmount es estable: un importe ya redondeado se muestra igual que el valor sin redondear', () => {
    fc.assert(
      fc.property(fc.double({ max: 1e12, min: 0, noNaN: true }), (value) => {
        expect(formatArgentineAmount(value)).toBe(formatArgentineAmount(roundToCents(value)));
      }),
    );
  });

  it('formatArgentineAmount usa coma decimal con 2 decimales o ninguno, y punto solo de miles', () => {
    fc.assert(
      fc.property(amount, (value) => {
        expect(formatArgentineAmount(value)).toMatch(/^\d{1,3}(\.?\d{3})*(,\d{2})?$/);
        expect(formatArgentineMoney(value)).toBe(`$ ${formatArgentineAmount(value)}`);
      }),
    );
  });

  it('formatExchangeRate lleva entre 2 y 6 decimales (o ninguno) y vuelve al mismo valor', () => {
    const rate = fc.integer({ max: 10 ** 12, min: 1 }).map((micros) => new Big(micros).div(1_000_000).toNumber());

    fc.assert(
      fc.property(rate, (value) => {
        const text = formatExchangeRate(value);

        expect(text).toMatch(/^\d{1,3}(\.?\d{3})*(,\d{2,6})?$/);
        expect(parseArgentineAmount(text, { maxDecimals: 6 })).toEqual({ ok: true, value });
      }),
    );
  });
});

describe('parseStrictInteger y parseDocumentNumber (propiedades)', () => {
  it('cualquier texto da un entero no negativo o undefined', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        for (const parsed of [parseStrictInteger(raw), parseDocumentNumber(raw)]) {
          if (parsed !== undefined) {
            expect(Number.isInteger(parsed)).toBe(true);
            expect(parsed).toBeGreaterThanOrEqual(0);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('lee de vuelta un entero escrito con o sin separadores', () => {
    fc.assert(
      fc.property(fc.integer({ max: Number.MAX_SAFE_INTEGER, min: 0 }), (value) => {
        expect(parseStrictInteger(` ${value} `)).toBe(value);
        expect(parseDocumentNumber(String(value).replace(/(\d)(?=(\d{3})+$)/g, '$1.'))).toBe(value);
      }),
    );
  });
});
