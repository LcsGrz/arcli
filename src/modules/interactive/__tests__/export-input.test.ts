import { describe, expect, it } from 'vitest';

import { buildExportInput, type ExportFlowState } from '../export-input';

const STATE: ExportFlowState = {
  amount: 1500,
  clientAddress: '123 Main St',
  clientName: 'ACME LLC',
  clientTaxId: '12-3456789',
  currencyCode: 'DOL',
  description: 'Consultoría',
  destinationCountry: 'ESTADOS UNIDOS',
  exportType: 2,
  options: {},
  paymentDate: '20/11/2026',
  paymentTerms: 'Transferencia',
  sameCurrency: true,
};

describe('buildExportInput', () => {
  it('arma la entrada de `arcli fe` con lo respondido, sin emitir', () => {
    expect(buildExportInput(STATE, {})).toEqual({
      activity: undefined,
      amount: 1500,
      clientAddress: '123 Main St',
      clientName: 'ACME LLC',
      clientTaxId: '12-3456789',
      currencyCode: 'DOL',
      description: 'Consultoría',
      destinationCountry: 'ESTADOS UNIDOS',
      emit: false,
      exportType: 2,
      incoterm: undefined,
      paymentDate: '20/11/2026',
      paymentTerms: 'Transferencia',
      permits: undefined,
      permitsExisting: undefined,
      sameCurrency: true,
    });
  });

  it('la actividad escrita le gana a la de la config; sin escribirla, va la de la config', () => {
    expect(buildExportInput({ ...STATE, activity: 711000 }, { configuredActivity: 620100 }).activity).toBe(711000);
    expect(buildExportInput(STATE, { configuredActivity: 620100 }).activity).toBe(620100);
  });

  it('los permisos van como ya existentes; sin permisos, tampoco la marca', () => {
    expect(buildExportInput({ ...STATE, exportType: 1, permits: ['26001EC01000123A'] }, {})).toMatchObject({
      permits: ['26001EC01000123A'],
      permitsExisting: true,
    });
  });

  it('suma los opcionales y la cotización escrita', () => {
    const input = buildExportInput(
      {
        ...STATE,
        exchangeRate: 1180,
        incoterm: 'FOB',
        options: { incotermDescription: 'FOB Bs. As.', language: 2, voucherDate: '17/11/2026' },
      },
      {},
    );

    expect(input).toMatchObject({
      exchangeRate: 1180,
      incoterm: 'FOB',
      incotermDescription: 'FOB Bs. As.',
      language: 2,
      voucherDate: '17/11/2026',
    });
  });
});
