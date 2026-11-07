import { afterEach, describe, expect, it, vi } from 'vitest';

import { uiSymbol } from '../symbols';

describe('uiSymbol', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the unicode symbol by default', () => {
    expect(uiSymbol('check')).toBe('✓');
  });

  it('uses the ascii fallback with ARCLI_ASCII=1', () => {
    vi.stubEnv('ARCLI_ASCII', '1');

    expect(uiSymbol('check')).toBe('v');
  });
});
