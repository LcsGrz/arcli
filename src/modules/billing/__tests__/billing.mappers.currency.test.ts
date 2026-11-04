import { describe, expect, it } from 'vitest';

import { resolveBillingCurrencyCode } from '../billing.mappers';

describe('resolveBillingCurrencyCode', () => {
  it.each([
    ['ARS', 'PES'],
    ['usd', 'DOL'],
    ['EUR', '060'],
    ['BRL', '012'],
    ['060', '060'],
  ])('traduce %s al código de ARCA %s', (input, expected) => {
    expect(resolveBillingCurrencyCode(input)).toBe(expected);
  });
});
