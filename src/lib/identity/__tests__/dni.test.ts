import { describe, expect, it } from 'vitest';

import { parseDni } from '../dni';

describe('parseDni', () => {
  it.each([
    ['123456', '123456'],
    ['12345678', '12345678'],
    ['30.123.456', '30123456'],
    [543210, '543210'],
  ])('acepta %j', (raw, value) => {
    expect(parseDni(raw)).toEqual({ ok: true, value });
  });

  it.each(['12345', '123456789', '', '30-123-456', 'abcdefg', 1234])('rechaza %j', (raw) => {
    expect(parseDni(raw)).toEqual({ ok: false, reason: 'debe tener de 6 a 8 dígitos' });
  });
});
