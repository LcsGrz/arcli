import { describe, expect, it } from 'vitest';

import { describeInvalidCbu, parseCbu } from '../cbu';

describe('parseCbu', () => {
  it.each([
    ['0110599520000012345678', '0110599520000012345678'],
    [' 0110599520000012345678 ', '0110599520000012345678'],
    ['2850590940090418135201', '2850590940090418135201'],
    ['0000000000000000000000', '0000000000000000000000'],
  ])('accepts %j', (raw, value) => {
    expect(parseCbu(raw)).toEqual({ ok: true, value });
  });

  it.each([
    ['0110599420000012345678', /bloque de banco y sucursal/],
    ['0110599620000012345678', /bloque de banco y sucursal/],
    ['1110599520000012345678', /bloque de banco y sucursal/],
    ['0110599520000012345677', /bloque de la cuenta/],
    ['0110599520000012345679', /bloque de la cuenta/],
    ['0110599520000012345668', /bloque de la cuenta/],
  ])('rejects %j with a wrong check digit and names the block', (raw, reason) => {
    expect(parseCbu(raw)).toEqual({ ok: false, reason: expect.stringMatching(reason) });
  });

  it.each([
    ['011059952000001234567'],
    ['01105995200000123456789'],
    [''],
    ['0110-5995-2000-0012-3456-78'],
    ['0110 5995 2000 0012 3456 78'],
    ['011059952000001234567a'],
    ['O110599520000012345678'],
  ])('rejects %j because it is not 22 digits', (raw) => {
    expect(parseCbu(raw)).toEqual({ ok: false, reason: expect.stringMatching(/22 dígitos/) });
  });
});

describe('describeInvalidCbu', () => {
  it('builds the same message with or without the value', () => {
    expect(describeInvalidCbu('debe tener 22 dígitos')).toBe(
      'El CBU no es válido: debe tener 22 dígitos. Revisá que esté bien escrito.',
    );
    expect(describeInvalidCbu('debe tener 22 dígitos', '123')).toBe(
      'El CBU "123" no es válido: debe tener 22 dígitos. Revisá que esté bien escrito.',
    );
  });
});
