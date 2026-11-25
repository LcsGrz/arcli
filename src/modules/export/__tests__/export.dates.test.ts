import { describe, expect, it } from 'vitest';

import { assertExportVoucherDate, resolveExportVoucherDate } from '../export.dates';

describe('resolveExportVoucherDate', () => {
  it('usa la fecha argentina de hoy cuando no se indica', () => {
    expect(resolveExportVoucherDate(undefined, new Date('2026-06-01T15:00:00Z'))).toBe('20260601');
  });

  it('acepta la fecha del usuario', () => {
    expect(resolveExportVoucherDate('1/6/2026', new Date('2026-06-01T15:00:00Z'))).toBe('20260601');
  });
});

describe('assertExportVoucherDate (ARCA 1500)', () => {
  const today = '20261118';

  it('acepta de hoy - 5 a hoy + 5', () => {
    for (const voucherDate of ['20261113', '20261118', '20261123']) {
      expect(() => assertExportVoucherDate({ exportType: 1, today, voucherDate })).not.toThrow();
    }
  });

  it('rechaza mas de 5 dias antes o despues, con el rango', () => {
    expect(() => assertExportVoucherDate({ exportType: 1, today, voucherDate: '20261112' })).toThrow(
      /del 13\/11\/2026 al 23\/11\/2026.*error 1500/,
    );
    expect(() => assertExportVoucherDate({ exportType: 4, today, voucherDate: '20261124' })).toThrow(/error 1500/);
  });

  it('en servicios no deja pasar el fin de mes', () => {
    expect(() => assertExportVoucherDate({ exportType: 2, today: '20261128', voucherDate: '20261130' })).not.toThrow();
    expect(() => assertExportVoucherDate({ exportType: 2, today: '20261128', voucherDate: '20261201' })).toThrow(
      /al 30\/11\/2026.*fin de mes/,
    );
    expect(() => assertExportVoucherDate({ exportType: 1, today: '20261128', voucherDate: '20261201' })).not.toThrow();
  });

  it('en servicios, si el fin de mes es el último día de la ventana, el tope es el de los 5 días (TEST-17)', () => {
    // El 25/11 la ventana termina el 30/11, que también es el fin de mes: el error no culpa al fin de mes.
    expect(() => assertExportVoucherDate({ exportType: 2, today: '20261125', voucherDate: '20261130' })).not.toThrow();
    expect(() => assertExportVoucherDate({ exportType: 2, today: '20261125', voucherDate: '20261201' })).toThrow(
      /al 30\/11\/2026, hasta 5 días antes o después de hoy \(error 1500\)/,
    );
  });
});
