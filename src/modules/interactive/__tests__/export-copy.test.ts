import { describe, expect, it } from 'vitest';

import type { ExportIssuedVoucher } from '../../export/export.types';
import { copyExportInvoice } from '../export-copy';

const INVOICE: ExportIssuedVoucher = {
  activities: [620100],
  arcaType: 19,
  clientAddress: '123 Main St, Miami, FL',
  clientCountryCuit: 55000002126,
  clientName: 'ACME LLC',
  clientTaxId: '12-3456789',
  currencyCode: 'DOL',
  date: '20261030',
  destinationCountry: 212,
  exchangeRate: 1174.605,
  exportType: 2,
  language: 1,
  number: 1,
  paymentTerms: 'Transferencia Internacional',
  pointOfSale: 4,
  sameCurrency: true,
  total: 1500,
};

describe('copyExportInvoice', () => {
  it('copia cliente, moneda, forma de pago y actividad, sin la cotización ni las fechas', () => {
    const { input, limitation } = copyExportInvoice(INVOICE);

    expect(limitation).toBeUndefined();
    expect(input).toEqual({
      activity: 620100,
      amount: 1500,
      clientAddress: '123 Main St, Miami, FL',
      clientCountryCuit: 55000002126,
      clientName: 'ACME LLC',
      clientTaxId: '12-3456789',
      currencyCode: 'DOL',
      exportType: 2,
      incoterm: undefined,
      incotermDescription: undefined,
      language: undefined,
      paymentTerms: 'Transferencia Internacional',
      sameCurrency: true,
    });
  });

  it('no repite el CUIT del país si es el que ARCA publica para el destino', () => {
    expect(copyExportInvoice(INVOICE, 55000002126).input.clientCountryCuit).toBeUndefined();
    expect(copyExportInvoice(INVOICE, 55000009999).input.clientCountryCuit).toBe(55000002126);
  });

  it('en pesos no se cobra en la misma moneda, y copia el idioma y la descripción del incoterm si no son los de siempre', () => {
    const { input } = copyExportInvoice({
      ...INVOICE,
      currencyCode: 'PES',
      exportType: 1,
      incoterm: 'FOB',
      incotermDescription: 'Free on board, Buenos Aires',
      language: 2,
      sameCurrency: undefined,
    });

    expect(input).toMatchObject({
      incoterm: 'FOB',
      incotermDescription: 'Free on board, Buenos Aires',
      language: 2,
      sameCurrency: false,
    });
    expect(
      copyExportInvoice({ ...INVOICE, incoterm: 'FOB', incotermDescription: 'FOB' }).input.incotermDescription,
    ).toBeUndefined();
  });

  it('un solo renglón por el total se repite como descripción, no como ítem', () => {
    const { input } = copyExportInvoice({
      ...INVOICE,
      items: [{ description: 'Consultoría', discount: 0, quantity: 1, total: 1500, unit: 7, unitPrice: 1500 }],
    });

    expect(input.description).toBe('Consultoría');
    expect(input.items).toBeUndefined();
  });

  it('copia los ítems si suman el total', () => {
    const { input } = copyExportInvoice({
      ...INVOICE,
      items: [
        { code: '001', description: 'Horas', discount: 0, quantity: 10, total: 1000, unit: 7, unitPrice: 100 },
        { description: 'Soporte', discount: 0, quantity: 1, total: 500, unit: 7, unitPrice: 500 },
      ],
    });

    expect(input.items).toEqual([
      { code: '001', description: 'Horas', quantity: 10, unit: 7, unitPrice: 100 },
      { code: undefined, description: 'Soporte', quantity: 1, unit: 7, unitPrice: 500 },
    ]);
    expect(input.description).toBeUndefined();
  });

  it('con bonificación o ítems que no suman el total, avisa y sale un renglón con el total', () => {
    const discounted = copyExportInvoice({
      ...INVOICE,
      items: [{ description: 'Horas', discount: 100, quantity: 16, total: 1500, unit: 7, unitPrice: 100 }],
    });
    const mismatched = copyExportInvoice({
      ...INVOICE,
      items: [{ description: 'Horas', discount: 0, quantity: 10, total: 1000, unit: 7, unitPrice: 100 }],
    });

    expect(discounted.input.items).toBeUndefined();
    expect(discounted.limitation).toMatch(/bonificación/);
    expect(mismatched.input.items).toBeUndefined();
    expect(mismatched.limitation).toMatch(/no suman su total/);
  });
});
