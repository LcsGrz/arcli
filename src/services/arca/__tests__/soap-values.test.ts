import { describe, expect, it } from 'vitest';

import { readLastNumber, readNumber, readOptionalText, readText } from '../soap-values';

const NOT_TEXT = [undefined, null, 0, 7, true, {}, ['a']];

describe('readText', () => {
  it('saca los espacios de alrededor', () => {
    expect(readText('  ACME LLC \n')).toBe('ACME LLC');
    expect(readText(' ')).toBe('');
  });

  it.each(NOT_TEXT.map((value) => [value]))('%j no es un texto: vacio', (value) => {
    expect(readText(value)).toBe('');
  });
});

describe('readOptionalText', () => {
  it('el texto, o `undefined` si queda vacio', () => {
    expect(readOptionalText(' 20261118 ')).toBe('20261118');
    expect(readOptionalText('0')).toBe('0');
    expect(readOptionalText('  ')).toBeUndefined();
    expect(readOptionalText('')).toBeUndefined();
  });

  it.each(NOT_TEXT.map((value) => [value]))('%j no es un texto: `undefined`', (value) => {
    expect(readOptionalText(value)).toBeUndefined();
  });
});

describe('readNumber', () => {
  it.each([
    [0, 0],
    [1450.25, 1450.25],
    [-1, -1],
    ['0', 0],
    [' 620100 ', 620100],
    ['1450.25', 1450.25],
  ])('%j es %d', (value, expected) => {
    expect(readNumber(value)).toBe(expected);
  });

  it.each([
    ['vacio', ''],
    ['espacios', '  '],
    ['un texto', 'abc'],
    ['con coma', '1,5'],
    ['NaN', Number.NaN],
    ['infinito', Infinity],
    ['infinito escrito', 'Infinity'],
    ['undefined', undefined],
    ['null', null],
    ['un booleano', true],
    ['un bigint', 1n],
    ['un objeto', {}],
    ['una lista', ['1']],
  ])('%s no es un numero: `undefined`', (_name, value) => {
    expect(readNumber(value)).toBeUndefined();
  });
});

describe('readLastNumber', () => {
  it.each([
    [0, 0],
    [41, 41],
    ['41', 41],
    [' 7 ', 7],
    ['0', 0],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  ])('%j es %d', (value, expected) => {
    expect(readLastNumber(value)).toBe(expected);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['vacio', ''],
    ['un texto', 'cuarenta'],
    ['negativo', -1],
    ['decimal', 41.5],
    ['decimal escrito', '41.5'],
    ['NaN', Number.NaN],
    ['fuera de lo seguro', Number.MAX_SAFE_INTEGER + 1],
  ])('%s no es un ultimo numero: `undefined`', (_name, value) => {
    expect(readLastNumber(value)).toBeUndefined();
  });
});
