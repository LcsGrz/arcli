import { describe, expect, it } from 'vitest';

import {
  applyExportAssociatedDefaults,
  assertExportNoteFields,
  assertExportNoteMatchesAssociated,
  exportAssociatedVoucherWarnings,
  resolveExportAssociatedQuery,
} from '../export.notes';
import {
  EXPORT_CREDIT_NOTE_KIND,
  EXPORT_DEBIT_NOTE_KIND,
  type ExportIssuedVoucher,
  type ExportVoucherInput,
  type ExportVoucherKind,
} from '../export.types';

/** La factura E de servicios que devolvio FEXGetCMP en testing (punto de venta 4, numero 1). */
const INVOICE: ExportIssuedVoucher = {
  activities: [620100],
  arcaType: 19,
  cae: '76443017092056',
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
  result: 'A',
  total: 1500,
};

const NOTE = {
  amount: 500,
  currencyCode: 'DOL',
  date: '20261109',
  destinationCountry: 212,
  exchangeRate: 1174.605,
  exportType: 2,
};

const INPUT: ExportVoucherInput = { amount: 500, emit: false, voucherNumber: 1 };

describe('resolveExportAssociatedQuery', () => {
  const base = { emitterCuit: '20409509763', kind: EXPORT_CREDIT_NOTE_KIND, pointOfSale: 4 };

  it('sin --ac es una factura E del punto de venta de la nota', () => {
    expect(resolveExportAssociatedQuery({ ...base, input: { number: 1 } })).toEqual({
      arcaType: 19,
      number: 1,
      pointOfSale: 4,
    });
  });

  it('acepta el asociado por atajo o por tipo, con otro punto de venta', () => {
    expect(resolveExportAssociatedQuery({ ...base, input: { number: 3, pointOfSale: 7, shortcut: 'NDE' } })).toEqual({
      arcaType: 20,
      number: 3,
      pointOfSale: 7,
    });
    expect(resolveExportAssociatedQuery({ ...base, input: { arcaType: 21, number: 3 } }).arcaType).toBe(21);
  });

  it('pide --ar', () => {
    expect(() => resolveExportAssociatedQuery({ ...base, input: {} })).toThrow(
      /Falta el número del comprobante asociado/,
    );
    expect(() => resolveExportAssociatedQuery({ ...base })).toThrow(/--ar/);
  });

  it('rechaza un asociado que no es E', () => {
    expect(() => resolveExportAssociatedQuery({ ...base, input: { number: 1, shortcut: 'fc' } })).toThrow(
      /`fe`, `nde` o `nce`/,
    );
    expect(() => resolveExportAssociatedQuery({ ...base, input: { arcaType: 11, number: 1 } })).toThrow(/19, 20 o 21/);
  });

  it('rechaza --ac y --at que no coinciden', () => {
    expect(() => resolveExportAssociatedQuery({ ...base, input: { arcaType: 21, number: 1, shortcut: 'fe' } })).toThrow(
      /es el tipo 19, no el 21/,
    );
  });

  it('el asociado tiene que ser del CUIT emisor (error 2031)', () => {
    expect(resolveExportAssociatedQuery({ ...base, input: { cuit: '20-40950976-3', number: 1 } }).number).toBe(1);
    expect(() => resolveExportAssociatedQuery({ ...base, input: { cuit: '20111111112', number: 1 } })).toThrow(
      /error 2031/,
    );
  });
});

describe('assertExportNoteFields', () => {
  it('rechaza lo que ARCA no acepta en una nota', () => {
    expect(() => assertExportNoteFields({ ...INPUT, paymentDate: '10/11' }, EXPORT_CREDIT_NOTE_KIND)).toThrow(
      /error 1673/,
    );
    expect(() => assertExportNoteFields({ ...INPUT, sameCurrency: true }, EXPORT_DEBIT_NOTE_KIND)).toThrow(
      /error 1605/,
    );
    expect(() => assertExportNoteFields({ ...INPUT, permits: ['P1'] }, EXPORT_CREDIT_NOTE_KIND)).toThrow(/permisos/);
    expect(() => assertExportNoteFields(INPUT, EXPORT_CREDIT_NOTE_KIND)).not.toThrow();
  });
});

describe('applyExportAssociatedDefaults', () => {
  it('completa la nota con los datos del asociado', () => {
    expect(applyExportAssociatedDefaults(INPUT, INVOICE)).toMatchObject({
      activity: 620100,
      clientAddress: '123 Main St, Miami, FL',
      clientCountryCuit: 55000002126,
      clientName: 'ACME LLC',
      clientTaxId: '12-3456789',
      currencyCode: 'DOL',
      destinationCountry: '212',
      exchangeRate: 1174.605,
      exportType: 2,
      language: 1,
      paymentTerms: 'Transferencia Internacional',
    });
  });

  it('los flags ganan, y con otra moneda no copia la cotizacion', () => {
    const input = applyExportAssociatedDefaults({ ...INPUT, clientName: 'Otro', currencyCode: 'PES' }, INVOICE);

    expect(input.clientName).toBe('Otro');
    expect(input.exchangeRate).toBeUndefined();
  });
});

describe('assertExportNoteMatchesAssociated', () => {
  const check =
    (
      note: Partial<typeof NOTE>,
      associated: Partial<ExportIssuedVoucher> = {},
      kind: ExportVoucherKind = EXPORT_CREDIT_NOTE_KIND,
    ) =>
    () =>
      assertExportNoteMatchesAssociated({
        associated: { ...INVOICE, ...associated },
        kind,
        note: { ...NOTE, ...note },
      });

  it('acepta una nota que coincide con el asociado', () => {
    expect(check({})).not.toThrow();
    expect(check({}, {}, EXPORT_DEBIT_NOTE_KIND)).not.toThrow();
  });

  it('rechaza un asociado que no esta aprobado', () => {
    expect(check({}, { result: 'R' })).toThrow(/no está autorizada/);
  });

  it('la nota no puede ser anterior al asociado', () => {
    expect(check({ date: '20261029' })).toThrow(/no puede ser anterior/);
  });

  it('la nota de credito no supera el total del asociado en la misma moneda', () => {
    expect(check({ amount: 2000 })).toThrow(/no puede superar el total/);
    expect(check({ amount: 2000 }, {}, EXPORT_DEBIT_NOTE_KIND)).not.toThrow();
  });

  it('en servicios pide el mismo tipo, destino, moneda y cotizacion (2049 a 2053)', () => {
    expect(check({ exportType: 4 })).toThrow(/error 2049/);
    expect(check({ destinationCountry: 203 })).toThrow(/error 2050/);
    expect(check({ currencyCode: '060' })).toThrow(/error 2051/);
    expect(check({ currencyCode: 'PES', exchangeRate: 1 })).not.toThrow();
    expect(check({ exchangeRate: 1200 })).toThrow(/1\.174,605.*error 2053/);
  });

  it('en servicios la ND solo ajusta una factura y la NC no ajusta otra NC (2041, 2042, 2045)', () => {
    expect(check({}, { arcaType: 21 }, EXPORT_DEBIT_NOTE_KIND)).toThrow(/errores 2041 y 2042/);
    expect(check({}, { arcaType: 21 })).toThrow(/error 2045/);
    expect(check({}, { arcaType: 20, associatedArcaType: 19 })).not.toThrow();
    expect(check({}, { arcaType: 20, associatedArcaType: 21 })).toThrow(/error 2055/);
  });

  it('en bienes no aplica las reglas de servicios', () => {
    expect(check({ destinationCountry: 203, exchangeRate: 1200, exportType: 1 }, { exportType: 1 })).not.toThrow();
  });
});

describe('exportAssociatedVoucherWarnings', () => {
  it('avisa que la fecha del asociado no se usa', () => {
    expect(exportAssociatedVoucherWarnings({ date: '30/10', number: 1 })).toEqual([
      expect.stringContaining('`--afecha` no se usa'),
    ]);
    expect(exportAssociatedVoucherWarnings({ number: 1 })).toEqual([]);
  });
});
