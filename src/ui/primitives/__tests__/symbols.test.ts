import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderStorybookShowcase } from '../../../modules/storybook/showcase';
import { uiSymbol } from '../symbols';

// Lo que no es ASCII ni una letra del español: ARCLI_ASCII cambia bordes y simbolos, no el idioma.
// eslint-disable-next-line no-control-regex
const NOT_ALLOWED = /[^\u0000-\u007F¿¡áéíóúüñÁÉÍÓÚÜÑ]/g;

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

  it('leaves no unicode symbols in the storybook with ARCLI_ASCII=1', () => {
    vi.stubEnv('ARCLI_ASCII', '1');

    expect(renderStorybookShowcase().match(NOT_ALLOWED)).toBeNull();
  });
});
