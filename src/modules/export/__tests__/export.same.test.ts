import { describe, expect, it } from 'vitest';

import { isSameExportClient, isSameExportCountry, isSameExportIncoterm } from '../export.same';

describe('el mismo dato de la E', () => {
  it.each<[string, string, boolean]>([
    ['203', '0203', true],
    [' 203 ', '203', true],
    ['\t0203', '203 ', true],
    ['203', '212', false],
    ['203', '2030', false],
    // Sin código no hay número: los ceros y los dígitos son parte del nombre.
    ['Zona 01', 'Zona 1', false],
    ['01 Zona', '1 Zona', false],
    ['Brasil', ' BRASIL ', true],
    ['México', 'mexico', true],
    ['Estados  Unidos', 'estados unidos', true],
    ['Brasil', 'Chile', false],
    ['Brasil', '203', false],
  ])('país %j y %j: %s', (left, right, same) => {
    expect(isSameExportCountry(left, right)).toBe(same);
    expect(isSameExportCountry(right, left)).toBe(same);
  });

  it('cliente e incoterm: sin mayúsculas, tildes ni espacios', () => {
    expect(isSameExportClient('São  João', ' sao joao')).toBe(true);
    expect(isSameExportClient('ACME', 'ACME LLC')).toBe(false);
    expect(isSameExportIncoterm(' fob ', 'FOB')).toBe(true);
    expect(isSameExportIncoterm('FOB', 'CIF')).toBe(false);
  });
});
