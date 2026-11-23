import { describe, expect, it } from 'vitest';

import { resolveEmitDecision } from '../billing.emit-decision';

const bothFlagsMessage = 'los dos flags';

describe('resolveEmitDecision', () => {
  it('sin nada que lo pida no emite', () => {
    expect(resolveEmitDecision({ bothFlagsMessage, flags: {} })).toEqual({ emit: false, source: 'default' });
  });

  it('con los dos flags usa el texto que le pasa cada familia', () => {
    expect(() => resolveEmitDecision({ bothFlagsMessage, flags: { emitir: true, previsualizar: true } })).toThrow(
      bothFlagsMessage,
    );
  });

  // Commander nunca pone `false` en `--previsualizar`, pero si llegara no se emite: antes la E emitía y A/B/C no.
  it('`previsualizar: false` en los flags decide no emitir, aunque la config y el archivo digan emitir', () => {
    expect(
      resolveEmitDecision({
        bothFlagsMessage,
        defaultEmit: true,
        file: { emitir: true },
        flags: { previsualizar: false },
      }),
    ).toEqual({ emit: false, source: 'flags' });
  });

  it('`previsualizar: false` en el archivo no dice nada: decide la config', () => {
    expect(
      resolveEmitDecision({ bothFlagsMessage, defaultEmit: true, file: { previsualizar: false }, flags: {} }),
    ).toEqual({ emit: true, source: 'default' });
  });
});
