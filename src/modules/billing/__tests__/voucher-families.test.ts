import { describe, expect, it } from 'vitest';

import { InputValidationError } from '../../../lib/errors/app-error';
import { associatedKindGroups } from '../../interactive/associated-kinds';
import { reciboChoices } from '../../interactive/choices';
import { resolveTaxAmounts } from '../billing.amounts';
import { resolveAssociatedVouchers } from '../billing.associated-vouchers';
import { FCE_OPTIONAL_IDS, resolveElectronicCreditOptionals } from '../billing.fce';
import type { BillingCommandInput } from '../billing.schemas';
import type { VoucherFamily, VoucherLetter } from '../billing.types';
import {
  discriminatesIva,
  isFceInvoice,
  isNote,
  isReceipt,
  noteSide,
  VOUCHER_FAMILIES,
  VOUCHER_KIND_MAP,
  VOUCHER_LETTERS,
  VOUCHER_SHORTCUTS,
} from '../voucher-kind-map';

/** Hoy (yyyymmdd): las reglas de los importes no lo usan. */
const TODAY = '20261118';

/**
 * Caracterización de ARQ8-1: qué es cada familia de comprobante. Hoy la respuesta está repartida en copias
 * (`NOTE_FAMILIES`, `CREDIT_NOTE_FAMILIES`, `family === 'factura-credito-electronica'`, `letter !== 'c'`); acá se fija
 * por lo que se ve afuera, para que el refactor a predicados (`isNote`, `noteSide`, `isReceipt`, `isFceInvoice`,
 * `discriminatesIva`) no cambie ninguna. Una familia nueva sin fila en `FAMILIES` hace fallar el primer test.
 */

type NoteSide = 'credito' | 'debito';

interface FamilyClass {
  readonly fceInvoice: boolean;
  readonly noteSide: NoteSide | undefined;
  readonly receipt: boolean;
}

const FAMILIES: Readonly<Record<VoucherFamily, FamilyClass>> = {
  factura: { fceInvoice: false, noteSide: undefined, receipt: false },
  'factura-credito-electronica': { fceInvoice: true, noteSide: undefined, receipt: false },
  'nota-credito': { fceInvoice: false, noteSide: 'credito', receipt: false },
  'nota-credito-electronica': { fceInvoice: false, noteSide: 'credito', receipt: false },
  'nota-debito': { fceInvoice: false, noteSide: 'debito', receipt: false },
  'nota-debito-electronica': { fceInvoice: false, noteSide: 'debito', receipt: false },
  recibo: { fceInvoice: false, noteSide: undefined, receipt: true },
};

const DISCRIMINATES_IVA: Readonly<Record<VoucherLetter, boolean>> = { a: true, b: true, c: false };

const CBU = '0110599520000001234567';

const KINDS = VOUCHER_SHORTCUTS.map((shortcut) => VOUCHER_KIND_MAP[shortcut]);

const kindsOf = (family: VoucherFamily) => KINDS.filter((kind) => kind.family === family);

/** Las notas A, B, C y FCE que ofrece el asistente como asociado, por el lado donde las agrupa. */
function associableNotesBySide(): Record<NoteSide, Set<VoucherFamily>> {
  const sides: Record<NoteSide, Set<VoucherFamily>> = { credito: new Set(), debito: new Set() };

  for (const noteKind of ['credito', 'debito'] as const) {
    for (const group of associatedKindGroups(noteKind)) {
      const side = group.family === 'nota-credito' ? 'credito' : group.family === 'nota-debito' ? 'debito' : undefined;

      if (!side) {
        continue;
      }

      for (const option of group.options) {
        if ('family' in option.value) {
          sides[side].add(option.value.family);
        }
      }
    }
  }

  return sides;
}

describe('familias de comprobante (caracterización de ARQ8-1)', () => {
  it('la tabla nombra cada familia de VOUCHER_FAMILIES, ni una más ni una menos', () => {
    expect([...VOUCHER_FAMILIES].sort()).toEqual(Object.keys(FAMILIES).sort());
  });

  describe.each(Object.entries(FAMILIES) as Array<[VoucherFamily, FamilyClass]>)('%s', (family, expected) => {
    it(`${expected.noteSide ? 'es nota' : 'no es nota'}: pide comprobante asociado solo si es nota`, () => {
      const kinds = kindsOf(family);

      expect(kinds.length).toBeGreaterThan(0);

      for (const voucherKind of kinds) {
        const resolve = () =>
          resolveAssociatedVouchers({
            billingDate: TODAY,
            emitterCuit: 20111111112,
            input: { shortcut: voucherKind.shortcut } as BillingCommandInput,
            requireVoucherKind: () => voucherKind,
            today: TODAY,
            voucherKind,
          });

        if (expected.noteSide) {
          expect(resolve).toThrow('requiere comprobante asociado');
        } else {
          expect(resolve()).toBeUndefined();
        }
      }
    });

    it(`lado de la nota: ${expected.noteSide ?? 'ninguno'}`, () => {
      const sides = associableNotesBySide();

      expect({ credito: sides.credito.has(family), debito: sides.debito.has(family) }).toEqual({
        credito: expected.noteSide === 'credito',
        debito: expected.noteSide === 'debito',
      });
    });

    it(`${expected.receipt ? 'es recibo' : 'no es recibo'}`, () => {
      const receiptFamilies = new Set(reciboChoices().map((choice) => choice.value.family));

      expect(receiptFamilies.has(family)).toBe(expected.receipt);
    });

    // Lo que recibe ARCA en Opcionales con un CBU: solo la factura FCE lo lleva (10168); en el resto es error (10169,
    // 10172, WSFEv1 v4.7).
    it(`${expected.fceInvoice ? 'es factura FCE: lleva el CBU' : 'no es factura FCE: no lleva el CBU'}`, () => {
      for (const kind of kindsOf(family)) {
        const resolve = () =>
          resolveElectronicCreditOptionals(
            { cancellation: false, cbu: CBU, cbuAlias: undefined, transferMode: undefined },
            kind,
          );

        if (expected.fceInvoice) {
          expect(resolve()).toContainEqual({ Id: FCE_OPTIONAL_IDS.cbu, Valor: CBU });
        } else {
          expect(resolve).toThrow(InputValidationError);
        }
      }
    });
  });

  describe.each(Object.entries(DISCRIMINATES_IVA) as Array<[VoucherLetter, boolean]>)(
    'letra %s',
    (letter, expected) => {
      it(`${expected ? 'discrimina' : 'no discrimina'} IVA en cada comprobante de la letra`, () => {
        const kinds = KINDS.filter((kind) => kind.letter === letter);

        expect(kinds.length).toBeGreaterThan(0);
        // Lo que recibe ARCA en ImpIVA por un total de 121 con la alícuota por defecto (21 %).
        expect(kinds.map((kind) => resolveTaxAmounts({ totalAmount: 121 }, kind, TODAY).ivaAmount)).toEqual(
          kinds.map(() => (expected ? 21 : 0)),
        );
      });
    },
  );

  it('la tabla de letras nombra cada letra de VOUCHER_LETTERS', () => {
    expect([...VOUCHER_LETTERS].sort()).toEqual(Object.keys(DISCRIMINATES_IVA).sort());
  });
});

describe('predicados de familia (ARQ8-1)', () => {
  it('clasifican cada comprobante igual que la tabla', () => {
    expect(
      KINDS.map((kind) => ({
        fceInvoice: isFceInvoice(kind),
        note: isNote(kind),
        noteSide: noteSide(kind),
        receipt: isReceipt(kind),
        shortcut: kind.shortcut,
      })),
    ).toEqual(
      KINDS.map((kind) => ({
        fceInvoice: FAMILIES[kind.family].fceInvoice,
        note: FAMILIES[kind.family].noteSide !== undefined,
        noteSide: FAMILIES[kind.family].noteSide,
        receipt: FAMILIES[kind.family].receipt,
        shortcut: kind.shortcut,
      })),
    );
  });

  it('discriminatesIva da lo mismo que la tabla de letras', () => {
    expect(VOUCHER_LETTERS.map(discriminatesIva)).toEqual(VOUCHER_LETTERS.map((letter) => DISCRIMINATES_IVA[letter]));
  });
});
