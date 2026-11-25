import { describe, expect, it } from 'vitest';

import { assertExportTextLengths } from '../export.text-fields';

describe('assertExportTextLengths', () => {
  it('frena los textos mas largos que los de ARCA, con el codigo y el flag', () => {
    expect(() => assertExportTextLengths({ clientName: 'a'.repeat(200), emit: false })).not.toThrow();
    expect(() => assertExportTextLengths({ clientName: 'a'.repeat(201), emit: false })).toThrow(
      /200 caracteres y tiene 201.*error 1651.*--cliente/,
    );
    expect(() => assertExportTextLengths({ clientAddress: 'a'.repeat(301), emit: false })).toThrow(/error 1661/);
    expect(() => assertExportTextLengths({ emit: false, observations: 'a'.repeat(1001) })).toThrow(/error 1665/);
    expect(() => assertExportTextLengths({ commercialObservations: 'a'.repeat(4001), emit: false })).toThrow(
      /--obs-comerciales/,
    );
    expect(() => assertExportTextLengths({ emit: false, incotermDescription: 'a'.repeat(21) })).toThrow(/error 1642/);
    expect(() => assertExportTextLengths({ emit: false, paymentTerms: 'a'.repeat(51) })).toThrow(/--forma-pago/);
    expect(() => assertExportTextLengths({ clientTaxId: 'a'.repeat(51), emit: false })).toThrow(/--id-impositivo/);
  });

  it('cuenta caracteres, no unidades UTF-16', () => {
    expect(() => assertExportTextLengths({ emit: false, incotermDescription: '🚢'.repeat(20) })).not.toThrow();
  });
});
