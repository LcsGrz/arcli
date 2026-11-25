import { describe, expect, it } from 'vitest';

import { assertExportIncoterm, resolveExportIncoterm } from '../export.incoterm';

describe('resolveExportIncoterm', () => {
  const incoterms = [{ code: 'FOB', name: 'Free on Board' }];

  it('busca sin importar mayusculas', () => {
    expect(resolveExportIncoterm('fob', incoterms)).toEqual({ code: 'FOB', name: 'Free on Board' });
  });

  it('sin incoterm no valida nada', () => {
    expect(resolveExportIncoterm(undefined, [])).toBeUndefined();
  });

  it('rechaza uno que no esta en la tabla', () => {
    expect(() => resolveExportIncoterm('XYZ', incoterms)).toThrow(/no existe en la tabla/);
  });

  it('si ARCA devuelve la tabla vacia no valida, como la actividad (REV-62)', () => {
    expect(resolveExportIncoterm('fob', [])).toEqual({ code: 'FOB', name: 'FOB' });
  });
});

describe('assertExportIncoterm', () => {
  it('la factura de bienes lleva incoterm (1640); servicios, otros y las notas no', () => {
    expect(() => assertExportIncoterm({ exportType: 1, isNote: false })).toThrow(/error 1640/);
    expect(() => assertExportIncoterm({ exportType: 1, incoterm: 'FOB', isNote: false })).not.toThrow();
    expect(() => assertExportIncoterm({ exportType: 2, isNote: false })).not.toThrow();
    expect(() => assertExportIncoterm({ exportType: 1, isNote: true })).not.toThrow();
  });

  it('la descripcion del incoterm va con incoterm (1641)', () => {
    expect(() => assertExportIncoterm({ exportType: 2, incotermDescription: 'Puerto', isNote: false })).toThrow(
      /error 1641/,
    );
  });
});
