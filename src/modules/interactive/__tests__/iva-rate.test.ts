import { describe, expect, it } from 'vitest';

import { defaultIvaRate, explicitIvaRate } from '../iva-rate';

describe('defaultIvaRate', () => {
  it('prefers the rate deduced from the original voucher', () => {
    expect(defaultIvaRate({ alicuotaPorDefecto: '10.5' }, '27')).toBe('27');
  });

  it('falls back to the configured rate, then to 21%', () => {
    expect(defaultIvaRate({ alicuotaPorDefecto: '10.5' })).toBe('10.5');
    expect(defaultIvaRate({})).toBe('21');
  });
});

describe('explicitIvaRate', () => {
  it('omits 21% when there is no configured rate, as the CLI default', () => {
    expect(explicitIvaRate('21', {})).toBeUndefined();
  });

  it('keeps 21% when the config has another rate, so the equivalent command does not take it', () => {
    expect(explicitIvaRate('21', { alicuotaPorDefecto: '10.5' })).toBe('21');
  });

  it('keeps any other rate', () => {
    expect(explicitIvaRate('10.5', {})).toBe('10.5');
    expect(explicitIvaRate(undefined, {})).toBeUndefined();
  });
});
