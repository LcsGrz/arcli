import { describe, expect, it } from 'vitest';

import { InputValidationError } from '../../../lib/errors/app-error';
import {
  isIvaConditionAllowed,
  listAllowedIvaConditions,
  validateIvaConditionForVoucher,
} from '../billing.iva-receptor';
import { type BillingIvaCondition, billingIvaConditionSchema } from '../billing.schemas';
import type { VoucherLetter } from '../billing.types';
import { VOUCHER_KIND_MAP, VOUCHER_SHORTCUTS } from '../voucher-kind-map';

/**
 * Tabla de FEParamGetCondicionIvaReceptor (error 10243), escrita a mano para que un cambio en el código no se valide
 * contra sí mismo. Es la misma de docs/validation-rules.md.
 */
const EXPECTED: Readonly<Record<BillingIvaCondition, Readonly<Record<VoucherLetter, boolean>>>> = {
  'cliente-del-exterior': { a: false, b: true, c: true },
  'consumidor-final': { a: false, b: true, c: true },
  'iva-liberado': { a: false, b: true, c: true },
  'iva-no-alcanzado': { a: false, b: true, c: true },
  'monotributista-social': { a: true, b: false, c: true },
  'monotributo-trabajador-independiente-promovido': { a: true, b: false, c: true },
  'proveedor-del-exterior': { a: false, b: true, c: true },
  'responsable-inscripto': { a: true, b: false, c: true },
  'responsable-monotributo': { a: true, b: false, c: true },
  'sujeto-exento': { a: false, b: true, c: true },
  'sujeto-no-categorizado': { a: false, b: true, c: true },
};

const LETTERS = ['a', 'b', 'c'] as const;
const ROWS = billingIvaConditionSchema.options.flatMap((condition) =>
  LETTERS.map((letter) => [letter, condition, EXPECTED[condition][letter]] as const),
);

describe('IVA receptor por letra (10243)', () => {
  it('la tabla cubre todas las condiciones del schema', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...billingIvaConditionSchema.options].sort());
    expect(ROWS).toHaveLength(33);
  });

  it.each(ROWS)('letra %s con %s: %s', (letter, condition, allowed) => {
    expect(isIvaConditionAllowed(letter, condition)).toBe(allowed);
    expect(listAllowedIvaConditions(letter).includes(condition)).toBe(allowed);
  });

  it('la C admite todas y A y B no se pisan', () => {
    expect([...listAllowedIvaConditions('c')].sort()).toEqual([...billingIvaConditionSchema.options].sort());

    const a = listAllowedIvaConditions('a');
    const b = listAllowedIvaConditions('b');

    expect(a.filter((condition) => b.includes(condition))).toEqual([]);
    expect([...a, ...b].sort()).toEqual([...billingIvaConditionSchema.options].sort());
  });

  // Todos los comprobantes con letra (factura, notas y FCE) siguen la tabla de su letra.
  const VOUCHER_ROWS = VOUCHER_SHORTCUTS.flatMap((shortcut) =>
    billingIvaConditionSchema.options.map((condition) => [shortcut, condition] as const),
  );

  it.each(VOUCHER_ROWS)('%s con %s valida según su letra', (shortcut, condition) => {
    const voucherKind = VOUCHER_KIND_MAP[shortcut];
    const validate = () => validateIvaConditionForVoucher(condition, voucherKind);

    if (EXPECTED[condition][voucherKind.letter]) {
      expect(validate).not.toThrow();
      return;
    }

    const suggested = voucherKind.letter === 'a' ? 'B' : 'A';

    expect(validate).toThrow(InputValidationError);
    expect(validate).toThrow(`no admite IVA receptor "${condition}". Usá un comprobante letra ${suggested}.`);
  });
});
