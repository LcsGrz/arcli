import { describe, expect, it } from 'vitest';

import { formatVoucherNumber } from '../voucher-number';

describe('formatVoucherNumber', () => {
  it('rellena el punto de venta a 5 dígitos y el número a 8', () => {
    expect(formatVoucherNumber(3, 12)).toBe('00003-00000012');
    expect(formatVoucherNumber(99_998, 99_999_999)).toBe('99998-99999999');
  });
});
