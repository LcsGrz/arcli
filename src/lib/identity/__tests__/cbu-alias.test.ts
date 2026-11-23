import { describe, expect, it } from 'vitest';

import { describeInvalidCbuAlias, parseCbuAlias } from '../cbu-alias';

describe('parseCbuAlias', () => {
  it.each([
    ['abcdef', 'abcdef'],
    ['a'.repeat(20), 'a'.repeat(20)],
    [' mi.alias-cbu ', 'mi.alias-cbu'],
    ['MI.ALIAS.99', 'MI.ALIAS.99'],
  ])('acepta %j', (raw, value) => {
    expect(parseCbuAlias(raw)).toEqual({ ok: true, value });
  });

  it.each(['abcde', 'a'.repeat(21), 'con espacio', 'ñandú.alias', 'alias_cbu', ''])('rechaza %j', (raw) => {
    expect(parseCbuAlias(raw)).toEqual({
      ok: false,
      reason: 'debe tener entre 6 y 20 letras, números, puntos o guiones',
    });
  });
});

describe('describeInvalidCbuAlias', () => {
  it('nombra el alias si lo recibe', () => {
    expect(describeInvalidCbuAlias('debe tener entre 6 y 20 letras', 'abc')).toBe(
      'El alias "abc" no es válido: debe tener entre 6 y 20 letras.',
    );
    expect(describeInvalidCbuAlias('debe tener entre 6 y 20 letras')).toBe(
      'El alias no es válido: debe tener entre 6 y 20 letras.',
    );
  });
});
