import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseCbu } from '../cbu';
import { parseCuit } from '../cuit';
import { formatCuit } from '../format-cuit';

/** Modulo 11 escrito de nuevo para el test, con los pesos de ARCA. `undefined` si da 10 (no se asigna). */
function cuitCheckDigit(firstTen: string): number | undefined {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((total, weight, index) => total + weight * Number(firstTen[index]), 0);
  const digit = (11 - (sum % 11)) % 11;

  return digit === 10 ? undefined : digit;
}

function cbuBlockCheckDigit(digits: string, weights: readonly number[]): number {
  const sum = weights.reduce((total, weight, index) => total + weight * Number(digits[index]), 0);

  return (10 - (sum % 10)) % 10;
}

const digits = (length: number) => fc.stringMatching(new RegExp(`^\\d{${length}}$`));

const validCuit = digits(10)
  .filter((firstTen) => cuitCheckDigit(firstTen) !== undefined)
  .map((firstTen) => `${firstTen}${cuitCheckDigit(firstTen)}`);

const validCbu = fc.tuple(digits(7), digits(13)).map(([bank, account]) => {
  const bankBlock = `${bank}${cbuBlockCheckDigit(bank, [7, 1, 3, 9, 7, 1, 3])}`;

  return `${bankBlock}${account}${cbuBlockCheckDigit(account, [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3])}`;
});

/** Separadores que acepta parseCuit entre los dígitos. */
const separator = fc.constantFrom('', '-', '.', ' ');

describe('parseCuit (propiedades)', () => {
  it('acepta un CUIT válido con cualquier separador y devuelve sus 11 dígitos', () => {
    fc.assert(
      fc.property(validCuit, separator, separator, (cuit, first, second) => {
        const written = `${cuit.slice(0, 2)}${first}${cuit.slice(2, 10)}${second}${cuit.slice(10)}`;

        expect(parseCuit(written)).toEqual({ ok: true, value: cuit });
        expect(parseCuit(Number(cuit))).toEqual(cuit.startsWith('0') ? expect.anything() : { ok: true, value: cuit });
      }),
    );
  });

  it('cambiar un solo dígito de un CUIT válido lo vuelve inválido', () => {
    fc.assert(
      fc.property(validCuit, fc.integer({ max: 10, min: 0 }), fc.integer({ max: 9, min: 1 }), (cuit, index, delta) => {
        const changed = `${cuit.slice(0, index)}${(Number(cuit[index]) + delta) % 10}${cuit.slice(index + 1)}`;

        expect(parseCuit(changed).ok).toBe(false);
      }),
    );
  });

  it('formatCuit y parseCuit se deshacen', () => {
    fc.assert(
      fc.property(validCuit, (cuit) => {
        expect(formatCuit(cuit)).toMatch(/^\d{2}-\d{8}-\d$/);
        expect(parseCuit(formatCuit(cuit))).toEqual({ ok: true, value: cuit });
      }),
    );
  });

  it('cualquier texto o número da ok con 11 dígitos o un motivo, nunca una excepción', () => {
    const input = fc.oneof(fc.string(), fc.string({ unit: 'grapheme' }), digits(11), fc.double(), fc.integer());

    fc.assert(
      fc.property(input, (raw) => {
        const result = parseCuit(raw);

        if (result.ok) {
          expect(result.value).toMatch(/^\d{11}$/);
          expect(cuitCheckDigit(result.value.slice(0, 10))).toBe(Number(result.value[10]));
        } else {
          expect(result.reason).toEqual(expect.any(String));
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('parseCbu (propiedades)', () => {
  it('acepta un CBU con los dos verificadores bien', () => {
    fc.assert(
      fc.property(validCbu, (cbu) => {
        expect(parseCbu(` ${cbu} `)).toEqual({ ok: true, value: cbu });
      }),
    );
  });

  it('cambiar un solo dígito de un CBU válido lo vuelve inválido', () => {
    fc.assert(
      fc.property(validCbu, fc.integer({ max: 21, min: 0 }), fc.integer({ max: 9, min: 1 }), (cbu, index, delta) => {
        // Los pesos 1, 3, 7 y 9 son coprimos con 10: un dígito cambiado siempre cambia el verificador.
        const changed = `${cbu.slice(0, index)}${(Number(cbu[index]) + delta) % 10}${cbu.slice(index + 1)}`;

        expect(parseCbu(changed).ok).toBe(false);
      }),
    );
  });

  it('cualquier texto da ok o un motivo, nunca una excepción', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), digits(22)), (raw) => {
        const result = parseCbu(raw);

        expect(result.ok ? result.value : result.reason).toEqual(expect.any(String));
      }),
      { numRuns: 300 },
    );
  });
});
