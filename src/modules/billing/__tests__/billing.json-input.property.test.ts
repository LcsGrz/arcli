import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { InputValidationError } from '../../../lib/errors/app-error';
import { billingJsonInputSchema, parseBillingJsonInput, readBillingJsonItems } from '../billing.json-input';

const KEYS = Object.keys(billingJsonInputSchema.shape);

/** Claves reales, parecidas (typos, flags) y las que rompen objetos mal armados. */
const key = fc.oneof(
  fc.constantFrom(...KEYS),
  fc.constantFrom(...KEYS).map((name) => name.toUpperCase()),
  fc.constantFrom('monto', 'alicuota', 'cuit', 'pv', '__proto__', 'constructor', 'toString', 'hasOwnProperty', ''),
  fc.string({ maxLength: 12 }),
);
const value = fc.oneof(
  fc.jsonValue({ maxDepth: 2 }),
  fc.dictionary(key, fc.jsonValue({ maxDepth: 1 }), { maxKeys: 3 }),
);

describe('parseBillingJsonInput (propiedades)', () => {
  it('cualquier objeto da un comprobante o un InputValidationError que nombra cada clave', () => {
    fc.assert(
      fc.property(fc.dictionary(key, value, { maxKeys: 6 }), (input) => {
        try {
          const parsed = parseBillingJsonInput(input);

          for (const name of Object.keys(parsed)) {
            expect(KEYS).toContain(name);
          }
        } catch (error) {
          expect(error).toBeInstanceOf(InputValidationError);
          expect((error as InputValidationError).details?.campos).toEqual(
            expect.arrayContaining([expect.objectContaining({ mensaje: expect.any(String) })]),
          );
        }
      }),
      { numRuns: 300 },
    );
  });

  it('cualquier valor de JSON en la raíz da items o un InputValidationError', () => {
    fc.assert(
      fc.property(fc.oneof(fc.jsonValue({ maxDepth: 2 }), fc.anything({ maxDepth: 1 })), (source) => {
        try {
          const items = readBillingJsonItems(source);

          expect(items.length).toBeGreaterThan(0);
          items.forEach((item) => {
            try {
              parseBillingJsonInput(item);
            } catch (error) {
              expect(error).toBeInstanceOf(InputValidationError);
            }
          });
        } catch (error) {
          expect(error).toBeInstanceOf(InputValidationError);
        }
      }),
      { numRuns: 200 },
    );
  });
});
