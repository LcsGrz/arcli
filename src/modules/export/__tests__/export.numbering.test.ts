import { describe, expect, it } from 'vitest';

import { resolveExportNumber, resolveExportPointOfSale } from '../export.numbering';

describe('resolveExportNumber', () => {
  const base = { label: 'El numero', max: 99_999_999 };

  it('toma el indicado por el usuario', () => {
    expect(resolveExportNumber({ ...base, last: 10, provided: 3 })).toBe(3);
  });

  it('sigue al ultimo de ARCA', () => {
    expect(resolveExportNumber({ ...base, last: 10 })).toBe(11);
    expect(resolveExportNumber({ ...base, last: 0 })).toBe(1);
  });

  it('el indicado por el usuario empieza en 1 (TEST-16)', () => {
    expect(resolveExportNumber({ ...base, last: 10, provided: 1 })).toBe(1);
    expect(() => resolveExportNumber({ ...base, last: 10, provided: 0 })).toThrow(/entero positivo/);
    expect(() => resolveExportNumber({ ...base, last: 10, provided: -3 })).toThrow(/entero positivo/);
  });

  it('no permite pasar el maximo de ARCA, tampoco con el indicado por el usuario (1520)', () => {
    expect(() => resolveExportNumber({ ...base, last: 99_999_999 })).toThrow(/máximo/);
    expect(() => resolveExportNumber({ ...base, code: 1520, last: 0, provided: 100_000_000 })).toThrow(
      /99999999.*error 1520/,
    );
    expect(resolveExportNumber({ ...base, last: 0, provided: 99_999_999 })).toBe(99_999_999);
  });
});

describe('resolveExportPointOfSale (1510)', () => {
  it('va de 1 a 99.998', () => {
    expect(resolveExportPointOfSale(99_998, {})).toBe(99_998);
    expect(resolveExportPointOfSale(1, {})).toBe(1);
    expect(() => resolveExportPointOfSale(0, {})).toThrow(/entero positivo/);
    expect(() => resolveExportPointOfSale(undefined, { puntoVentaPorDefecto: 0 })).toThrow(/entero positivo/);
    expect(() => resolveExportPointOfSale(99_999, {})).toThrow(/1 a 99998.*error 1510/);
  });
});
