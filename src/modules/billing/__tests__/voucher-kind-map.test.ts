import { describe, expect, it } from 'vitest';

import {
  getVoucherKindByFamilyAndLetter,
  getVoucherKindByShortcut,
  isVoucherShortcut,
  VOUCHER_FAMILIES,
  VOUCHER_KIND_MAP,
  VOUCHER_SHORTCUTS,
} from '../voucher-kind-map';

describe('voucher-kind-map', () => {
  it('defines the 18 supported voucher shortcuts', () => {
    expect(VOUCHER_SHORTCUTS).toHaveLength(18);
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

  it('marks credit and debit notes as requiring associated vouchers', () => {
    expect(VOUCHER_KIND_MAP.nca.requiresAssociatedVoucher).toBe(true);
    expect(VOUCHER_KIND_MAP.ndea.requiresAssociatedVoucher).toBe(true);
    expect(VOUCHER_KIND_MAP.fa.requiresAssociatedVoucher).toBe(false);
  });

  it('recognizes valid shortcuts only', () => {
    expect(isVoucherShortcut('fcea')).toBe(true);
    expect(isVoucherShortcut('zzz')).toBe(false);
  });

  it('exposes the six configured voucher families', () => {
    expect(VOUCHER_FAMILIES).toEqual([
      'factura',
      'nota-credito',
      'nota-debito',
      'factura-credito-electronica',
      'nota-credito-electronica',
      'nota-debito-electronica',
    ]);
  });
});
