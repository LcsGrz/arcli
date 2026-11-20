import { describe, expect, it } from 'vitest';

import { buildExportRepeatInput, type ExportRepeatState } from '../export-repeat-input';

const STATE: ExportRepeatState = {
  copy: {
    activity: 620100,
    clientName: 'ACME LLC',
    currencyCode: 'DOL',
    exportType: 2,
    language: 1,
  },
  country: { code: 212, name: 'ESTADOS UNIDOS' },
  items: [{ description: 'Según detalle', quantity: 1, unit: 7, unitPrice: 1500 }],
};

describe('buildExportRepeatInput', () => {
  it('copia la factura, con el destino como está en la tabla de ARCA y el monto de los ítems, sin emitir', () => {
    expect(buildExportRepeatInput(STATE, {})).toEqual({
      activity: 620100,
      amount: 1500,
      clientName: 'ACME LLC',
      currencyCode: 'DOL',
      destinationCountry: 'ESTADOS UNIDOS',
      emit: false,
      exportType: 2,
      // Un renglón "Según detalle" por el total es lo que el CLI arma sin `--item` ni `--descripcion` (NAV-10).
      language: 1,
      paymentDate: undefined,
      permits: undefined,
      permitsExisting: undefined,
    });
  });

  it('la actividad de la factura le gana a la de la config; sin ella, va la de la config', () => {
    expect(buildExportRepeatInput(STATE, { configuredActivity: 711000 }).activity).toBe(620100);
    expect(
      buildExportRepeatInput({ ...STATE, copy: { ...STATE.copy, activity: undefined } }, { configuredActivity: 711000 })
        .activity,
    ).toBe(711000);
  });

  it('los opcionales le ganan a lo copiado, y suma fecha de pago y permisos ya existentes', () => {
    const input = buildExportRepeatInput(
      { ...STATE, options: { language: 2 }, paymentDate: '20/11/2026', permits: ['26001EC01000123A'] },
      {},
    );

    expect(input).toMatchObject({
      language: 2,
      paymentDate: '20/11/2026',
      permits: ['26001EC01000123A'],
      permitsExisting: true,
    });
  });

  it('sin la factura copiada o sin el destino, el flujo está mal armado', () => {
    expect(() => buildExportRepeatInput({ country: STATE.country }, {})).toThrow(/copy/);
    expect(() => buildExportRepeatInput({ copy: STATE.copy }, {})).toThrow(/country/);
  });
});
