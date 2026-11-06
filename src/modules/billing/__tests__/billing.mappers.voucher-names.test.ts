import { describe, expect, it } from 'vitest';

import { EXPORT_VOUCHER_KIND } from '../../export/export.types';
import {
  formatEmissionQuestion,
  formatLatestVouchersTitle,
  formatNoVouchersEmitted,
  formatVoucherLabel,
  formatVoucherSubject,
  formatVoucherWithArticle,
} from '../billing.mappers';
import { VOUCHER_KIND_MAP, VOUCHER_SHORTCUTS } from '../voucher-kind-map';

describe('nombres de comprobante dentro de una frase', () => {
  it('deja la letra en mayuscula en todos los comprobantes', () => {
    for (const shortcut of VOUCHER_SHORTCUTS) {
      const label = formatVoucherLabel(VOUCHER_KIND_MAP[shortcut]);

      expect(label).toMatch(/^\p{Ll}.* [ABC]$/u);
    }

    expect(formatVoucherLabel(EXPORT_VOUCHER_KIND)).toBe('factura de exportación E');
  });

  it('usa el articulo que corresponde', () => {
    expect(formatVoucherWithArticle(VOUCHER_KIND_MAP.fb)).toBe('la factura B');
    expect(formatVoucherWithArticle(VOUCHER_KIND_MAP.nca)).toBe('la nota de crédito A');
    expect(formatVoucherWithArticle(VOUCHER_KIND_MAP.rc)).toBe('el recibo C');
    expect(formatVoucherSubject(VOUCHER_KIND_MAP.fb)).toBe('La factura B');
    expect(formatVoucherSubject(VOUCHER_KIND_MAP.rc)).toBe('El recibo C');
  });

  it('arma el plural en la primera palabra y concuerda en genero', () => {
    expect(formatLatestVouchersTitle(VOUCHER_KIND_MAP.fb)).toBe('Últimas facturas B');
    expect(formatLatestVouchersTitle(VOUCHER_KIND_MAP.ncb)).toBe('Últimas notas de crédito B');
    expect(formatLatestVouchersTitle(VOUCHER_KIND_MAP.fcea)).toBe('Últimas facturas de crédito electrónica A');
    expect(formatLatestVouchersTitle(VOUCHER_KIND_MAP.rc)).toBe('Últimos recibos C');
    expect(formatNoVouchersEmitted(VOUCHER_KIND_MAP.fb)).toBe('No hay facturas B emitidas');
    expect(formatNoVouchersEmitted(VOUCHER_KIND_MAP.rc)).toBe('No hay recibos C emitidos');
  });
});

describe('formatEmissionQuestion', () => {
  it('dice en que entorno se emite', () => {
    expect(formatEmissionQuestion('la factura B', 'produccion')).toBe('¿Emitimos la factura B en PRODUCCIÓN?');
    expect(formatEmissionQuestion('el recibo C', 'testing')).toBe('¿Emitimos el recibo C en testing?');
  });
});
