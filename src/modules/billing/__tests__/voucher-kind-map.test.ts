import { describe, expect, it } from 'vitest';

import {
  getVoucherFamilyLetters,
  getVoucherKindByFamilyAndLetter,
  getVoucherKindByShortcut,
  isNote,
  VOUCHER_FAMILIES,
  VOUCHER_KIND_MAP,
  VOUCHER_SHORTCUTS,
} from '../voucher-kind-map';

describe('voucher-kind-map', () => {
  it('defines the 21 supported voucher shortcuts', () => {
    expect(VOUCHER_SHORTCUTS).toHaveLength(21);
  });

  it('defines recibos A (4) and B (9), like the C: not notes and with no associated voucher', () => {
    expect(VOUCHER_KIND_MAP.ra).toMatchObject({ arcaType: 4, displayName: 'Recibo A', family: 'recibo', letter: 'a' });
    expect(VOUCHER_KIND_MAP.rb).toMatchObject({ arcaType: 9, displayName: 'Recibo B', family: 'recibo', letter: 'b' });
    expect(isNote(VOUCHER_KIND_MAP.ra)).toBe(false);
    expect(VOUCHER_KIND_MAP.rb.isElectronicCredit).toBe(false);
    expect(getVoucherFamilyLetters('recibo')).toEqual(['a', 'b', 'c']);
  });

  it('defines a recibo C that is not a note and needs no associated voucher', () => {
    expect(VOUCHER_KIND_MAP.rc).toMatchObject({
      arcaType: 15,
      displayName: 'Recibo C',
      family: 'recibo',
      isElectronicCredit: false,
      letter: 'c',
    });
    expect(isNote(VOUCHER_KIND_MAP.rc)).toBe(false);
    expect(getVoucherKindByFamilyAndLetter('recibo', 'c')?.shortcut).toBe('rc');
    expect(getVoucherKindByFamilyAndLetter('recibo', 'a')?.shortcut).toBe('ra');
  });

  it('resolves a voucher by shortcut', () => {
    expect(getVoucherKindByShortcut('fa')).toMatchObject({
      arcaType: 1,
      family: 'factura',
      letter: 'a',
      shortcut: 'fa',
    });
  });

  it('resolves a voucher by family and letter', () => {
    expect(getVoucherKindByFamilyAndLetter('nota-credito-electronica', 'b')).toMatchObject({
      arcaType: 208,
      shortcut: 'nceb',
    });
  });

  it('marks credit and debit notes as notes', () => {
    expect(isNote(VOUCHER_KIND_MAP.nca)).toBe(true);
    expect(isNote(VOUCHER_KIND_MAP.ndea)).toBe(true);
    expect(isNote(VOUCHER_KIND_MAP.fa)).toBe(false);
  });

  it('exposes the seven configured voucher families', () => {
    expect(VOUCHER_FAMILIES).toEqual([
      'factura',
      'nota-credito',
      'nota-debito',
      'factura-credito-electronica',
      'nota-credito-electronica',
      'nota-debito-electronica',
      'recibo',
    ]);
  });
});
