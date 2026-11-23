import type { VoucherFamily, VoucherKindDefinition, VoucherLetter } from '../modules/billing/billing.types';
import { getVoucherFamilyLetters, getVoucherKindByFamilyAndLetter, isNote } from '../modules/billing/voucher-kind-map';

/** Qué comprobantes cubre un comando: un atajo es una letra; una familia, todas las suyas. */
export interface VoucherScope {
  readonly isElectronicCredit: boolean;
  readonly isNote: boolean;
  readonly letters: readonly VoucherLetter[];
}

/** El alcance de un atajo: decide las opciones que muestra y las reglas de su ayuda. */
export function shortcutScope(kind: VoucherKindDefinition): VoucherScope {
  return { isElectronicCredit: kind.isElectronicCredit, isNote: isNote(kind), letters: [kind.letter] };
}

/** El alcance de una familia, con todas sus letras (la E de exportación va aparte, por WSFEX). */
export function familyScope(family: VoucherFamily): VoucherScope {
  const letters = getVoucherFamilyLetters(family);

  return {
    isElectronicCredit: letters.some((letter) => getVoucherKindByFamilyAndLetter(family, letter)?.isElectronicCredit),
    isNote: isNote({ family }),
    letters,
  };
}
