import { describe, expect, it } from 'vitest';

import type { ExportIssuedVoucher } from '../../export/export.types';
import { copyExportInvoice, copyExportItems } from '../export-copy';

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

  it('avisa por qué los ítems no se copian, para mostrarlo al elegir la factura', () => {
    expect(
      copyExportInvoice({
        ...INVOICE,
        items: [{ description: 'Horas', discount: 100, quantity: 16, total: 1500, unit: 7, unitPrice: 100 }],
      }).limitation,
    ).toMatch(/bonificación/);
  });
});

describe('copyExportItems (NAV-10)', () => {
  it('sin ítems, arranca con un renglón por el total, con los valores por defecto del primero', () => {
    expect(copyExportItems(INVOICE)).toEqual({
      items: [{ description: 'Según detalle', quantity: 1, unit: 7, unitPrice: 1500 }],
    });
    expect(copyExportItems({ ...INVOICE, items: [] }).limitation).toBeUndefined();
  });

  it('un solo renglón por el total se copia como ítem, con su descripción', () => {
    expect(
      copyExportItems({
        ...INVOICE,
        items: [{ description: 'Consultoría', discount: 0, quantity: 1, total: 1500, unit: 7, unitPrice: 1500 }],
      }),
    ).toEqual({ items: [{ code: undefined, description: 'Consultoría', quantity: 1, unit: 7, unitPrice: 1500 }] });
  });

  it('copia los ítems si suman el total, con su código y su unidad', () => {
    const { items, limitation } = copyExportItems({
      ...INVOICE,
      items: [
        { code: '001', description: 'Horas', discount: 0, quantity: 10, total: 1000, unit: 7, unitPrice: 100 },
        { description: 'Jugo', discount: 0, quantity: 200, total: 500, unit: 5, unitPrice: 2.5 },
      ],
    });

    expect(limitation).toBeUndefined();
    expect(items).toEqual([
      { code: '001', description: 'Horas', quantity: 10, unit: 7, unitPrice: 100 },
      { code: undefined, description: 'Jugo', quantity: 200, unit: 5, unitPrice: 2.5 },
    ]);
  });

  it('con bonificación, seña o anticipo, o ítems que no suman el total, avisa y arranca con un renglón por el total', () => {
    const summary = [{ description: 'Según detalle', quantity: 1, unit: 7, unitPrice: 1500 }];
    // Con un solo ítem bonificado alcanza.
    const discounted = copyExportItems({
      ...INVOICE,
      items: [
        { description: 'Horas', discount: 0, quantity: 10, total: 1000, unit: 7, unitPrice: 100 },
        { description: 'Extra', discount: 100, quantity: 6, total: 500, unit: 7, unitPrice: 100 },
      ],
    });
    const advance = copyExportItems({
      ...INVOICE,
      items: [{ description: 'Anticipo', discount: 0, quantity: 0, total: 1500, unit: 97, unitPrice: 0 }],
    });
    const mismatched = copyExportItems({
      ...INVOICE,
      items: [{ description: 'Horas', discount: 0, quantity: 10, total: 1000, unit: 7, unitPrice: 100 }],
    });

    expect(discounted).toEqual({ items: summary, limitation: expect.stringMatching(/bonificación/) });
    expect(advance).toEqual({ items: summary, limitation: expect.stringMatching(/seña, anticipo/) });
    expect(mismatched).toEqual({ items: summary, limitation: expect.stringMatching(/no suman su total/) });
  });
});
