import { describe, expect, it } from 'vitest';

import { resolveExportCurrency, resolveExportQuotation, resolveExportQuotationDate } from '../export.currency';

describe('resolveExportCurrency', () => {
  it('por defecto la exportacion va en dolares y pide la cotizacion a ARCA', () => {
    expect(resolveExportCurrency({})).toEqual({
      fields: { CanMisMonExt: 'N', Moneda_ctz: 0, Moneda_Id: 'DOL' },
      needsQuotation: true,
    });
  });

  it('en pesos la cotizacion es 1, no hay que consultar ARCA y no va CanMisMonExt (error 1605)', () => {
    expect(resolveExportCurrency({ currencyCode: 'ARS' })).toEqual({
      fields: { Moneda_ctz: 1, Moneda_Id: 'PES' },
      needsQuotation: false,
    });
  });

  it('acepta el alias USD y la cotizacion escrita por el usuario', () => {
    expect(resolveExportCurrency({ currencyCode: 'USD', exchangeRate: 900.5 })).toEqual({
      fields: { CanMisMonExt: 'N', Moneda_ctz: 900.5, Moneda_Id: 'DOL' },
      needsQuotation: false,
    });
  });

  it('pide la cotizacion a ARCA cuando es moneda extranjera y no vino', () => {
    expect(resolveExportCurrency({ currencyCode: 'DOL' }).needsQuotation).toBe(true);
  });

  it('no usa la clave cotizacion de la config: sin --cotizacion-moneda va la de aduana de ARCA (REV-35)', () => {
    expect(resolveExportCurrency({ currencyCode: 'DOL' })).toEqual({
      fields: { CanMisMonExt: 'N', Moneda_ctz: 0, Moneda_Id: 'DOL' },
      needsQuotation: true,
    });
  });

  it('no acepta cotizacion en pesos distinta de 1 ni misma moneda en pesos', () => {
    expect(() => resolveExportCurrency({ currencyCode: 'ARS', exchangeRate: 2 })).toThrow(/cotización tiene que ser 1/);
    expect(() => resolveExportCurrency({ currencyCode: 'ARS', sameCurrency: true })).toThrow(/moneda extranjera/);
  });

  it('acepta cotizaciones menores a 1, como la del guarani: ARCA pide mayor a 0 (errores 1600 y 1602)', () => {
    expect(resolveExportCurrency({ currencyCode: '029', exchangeRate: 0.19 })).toEqual({
      fields: { CanMisMonExt: 'N', Moneda_ctz: 0.19, Moneda_Id: '029' },
      needsQuotation: false,
    });
  });

  it('rechaza una cotizacion en 0 o negativa en moneda extranjera', () => {
    expect(() => resolveExportCurrency({ currencyCode: 'USD', exchangeRate: 0 })).toThrow(
      'La cotización de USD tiene que ser mayor a 0.',
    );
    expect(() => resolveExportCurrency({ currencyCode: '029', exchangeRate: -1 })).toThrow(/mayor a 0/);
  });

  it('marca CanMisMonExt cuando el pago es en la misma moneda', () => {
    expect(resolveExportCurrency({ currencyCode: 'USD', exchangeRate: 900, sameCurrency: true }).fields).toEqual({
      CanMisMonExt: 'S',
      Moneda_ctz: 900,
      Moneda_Id: 'DOL',
    });
  });
});

describe('resolveExportQuotationDate', () => {
  const base = { exportType: 2 as const, isNote: false, sameCurrency: false, today: '20261118' };

  it('en la factura de servicios es el dia anterior a la fecha del comprobante (error 2053)', () => {
    expect(resolveExportQuotationDate({ ...base, voucherDate: '20261116' })).toEqual({
      date: '20261115',
      rule: 'previous-business-day',
    });
  });

  it('con fecha posterior a la de la solicitud es el dia anterior a hoy', () => {
    expect(resolveExportQuotationDate({ ...base, voucherDate: '20261120' }).date).toBe('20261117');
  });

  it('con el pago en la misma moneda tambien es el dia anterior, en cualquier tipo', () => {
    expect(
      resolveExportQuotationDate({ ...base, exportType: 1, sameCurrency: true, voucherDate: '20261118' }).date,
    ).toBe('20261117');
  });

  it('en bienes, otros y las notas es la fecha del comprobante', () => {
    expect(resolveExportQuotationDate({ ...base, exportType: 1, voucherDate: '20261118' })).toEqual({
      date: '20261118',
      rule: 'voucher-date',
    });
    expect(resolveExportQuotationDate({ ...base, exportType: 4, voucherDate: '20261118' }).date).toBe('20261118');
    expect(resolveExportQuotationDate({ ...base, isNote: true, voucherDate: '20261118' }).date).toBe('20261118');
  });

  it('con fecha futura en bienes es la de hoy: no hay cotizacion de un dia que no llego', () => {
    expect(resolveExportQuotationDate({ ...base, exportType: 1, voucherDate: '20261121' }).date).toBe('20261118');
  });
});

describe('resolveExportQuotation', () => {
  const QUOTATIONS = [
    { code: 'DOL', date: '20261027', rate: 1174 },
    { code: '060', date: '20261027', rate: 1300.5 },
  ];

  it('encuentra la moneda sin importar mayusculas ni espacios', () => {
    expect(resolveExportQuotation(' dol ', QUOTATIONS, '20261028')).toEqual(QUOTATIONS[0]);
  });

  it('falla con las monedas que si tienen cotizacion', () => {
    expect(() => resolveExportQuotation('019', QUOTATIONS, '20261028')).toThrow(
      /no informó la cotización de 019 para el 28\/10\/2026\. Las monedas con cotización son DOL, 060\./,
    );
  });

  it('sin cotizacion para la moneda es ARCA_QUOTATION_ERROR, sin errores de ARCA en detalles', () => {
    expect(() => resolveExportQuotation('019', QUOTATIONS, '20261028')).toThrow(
      expect.objectContaining({ code: 'ARCA_QUOTATION_ERROR', details: { errores: [] } }),
    );
  });

  it('pide la cotizacion por flag cuando ARCA no publico ninguna', () => {
    expect(() => resolveExportQuotation('DOL', [], '20270105')).toThrow(
      /no informó la cotización de DOL para el 05\/01\/2027\. Informá la cotización con `--cotizacion-moneda`\./,
    );
  });
});
