import { describe, expect, it } from 'vitest';

import { VOUCHER_KIND_MAP } from '../../billing/voucher-kind-map';
import { buildInvoiceInput, type InvoiceState, isFceInvoiceState } from '../invoice-input';

const PESOS = { currencyCode: 'ARS', sameCurrency: false } as const;
const NO_CONFIG = { config: {} };

const state = (overrides: Partial<InvoiceState> = {}): InvoiceState => ({
  advanced: PESOS,
  concept: 'servicios',
  documentType: 'consumidor-final',
  ivaCondition: 'consumidor-final',
  totalAmount: 1500,
  voucherKind: VOUCHER_KIND_MAP.fc,
  ...overrides,
});

describe('buildInvoiceInput', () => {
  it('arma la entrada del CLI con lo respondido: comprobante, concepto, receptor y monto', () => {
    expect(buildInvoiceInput(state(), NO_CONFIG)).toMatchObject({
      concept: 'servicios',
      currencyCode: 'ARS',
      documentNumber: 0,
      documentType: 'consumidor-final',
      ivaCondition: 'consumidor-final',
      shortcut: 'fc',
      totalAmount: 1500,
    });
  });

  it('en la C no lleva alícuota, aunque haya una en la config o en los opcionales', () => {
    const input = buildInvoiceInput(state({ advanced: { ...PESOS, ivaRate: '10.5' } }), {
      config: { alicuotaPorDefecto: '27' },
    });

    expect(input.ivaRate).toBeUndefined();
  });

  it('en la A y la B, 21% sin alícuota en la config no se escribe (es el default del CLI)', () => {
    expect(buildInvoiceInput(state({ voucherKind: VOUCHER_KIND_MAP.fb }), NO_CONFIG).ivaRate).toBeUndefined();
  });

  it('en la A y la B, la de la config va explícita, y la elegida le gana', () => {
    const b = state({ voucherKind: VOUCHER_KIND_MAP.fb });

    expect(buildInvoiceInput(b, { config: { alicuotaPorDefecto: '10.5' } }).ivaRate).toBe('10.5');
    expect(
      buildInvoiceInput({ ...b, advanced: { ...PESOS, ivaRate: '27' } }, { config: { alicuotaPorDefecto: '10.5' } })
        .ivaRate,
    ).toBe('27');
  });

  it('pasa los opcionales: fechas, moneda, cotización y de dónde salió (la de la config, #14)', () => {
    const input = buildInvoiceInput(
      state({
        advanced: {
          billingDate: '17/11/2026',
          currencyCode: 'USD',
          exchangeRate: 1400,
          exchangeRateSource: 'config',
          paymentDueDate: '25/11/2026',
          sameCurrency: false,
          serviceEndDate: '17/11/2026',
          serviceStartDate: '01/11/2026',
        },
      }),
      NO_CONFIG,
    );

    expect(input).toMatchObject({
      billingDate: '17/11/2026',
      currencyCode: 'USD',
      exchangeRate: 1400,
      exchangeRateSource: 'config',
      paymentDueDate: '25/11/2026',
      serviceEndDate: '17/11/2026',
      serviceStartDate: '01/11/2026',
    });
  });

  it('el consumidor final identificado en los opcionales va con su documento, sin repetir los datos del opcional', () => {
    const input = buildInvoiceInput(
      state({ advanced: { ...PESOS, consumerDocumentNumber: 30123456, consumerDocumentType: 'dni' } }),
      NO_CONFIG,
    );

    expect(input).toMatchObject({ documentNumber: 30123456, documentType: 'dni', ivaCondition: 'consumidor-final' });
    expect(input).not.toHaveProperty('consumerDocumentNumber');
    expect(input).not.toHaveProperty('consumerDocumentType');
  });

  it('con el CUIT del padrón, nombre, domicilio y el origen de la condición IVA', () => {
    const input = buildInvoiceInput(
      state({
        documentNumber: 30709965812,
        documentType: 'cuit',
        ivaCondition: 'responsable-inscripto',
        receiver: { address: 'Calle 1', cuit: 30709965812, ivaCondition: 'responsable-inscripto', name: 'Cliente SA' },
        voucherKind: VOUCHER_KIND_MAP.fa,
      }),
      NO_CONFIG,
    );

    expect(input).toMatchObject({
      documentNumber: 30709965812,
      ivaConditionSource: 'padron',
      receiverAddress: 'Calle 1',
      receiverName: 'Cliente SA',
    });
  });

  describe('FCE', () => {
    const fce = state({
      advanced: { ...PESOS, transferMode: 'adc' },
      documentNumber: 30709965812,
      documentType: 'cuit',
      ivaCondition: 'responsable-inscripto',
      voucherKind: VOUCHER_KIND_MAP.fcea,
    });

    it('el CBU y el alias escritos le ganan a los de la config', () => {
      const input = buildInvoiceInput(
        { ...fce, cbu: '0110599520000012345678', cbuAlias: 'escrito.alias' },
        { config: { aliasCbu: 'config.alias', cbu: '0170099220000067797370' } },
      );

      expect(input).toMatchObject({
        cbu: '0110599520000012345678',
        cbuAlias: 'escrito.alias',
        transferMode: 'adc',
      });
    });

    it('sin escribirlos, van los de la config, como en el CLI', () => {
      expect(
        buildInvoiceInput(fce, { config: { aliasCbu: 'config.alias', cbu: '0170099220000067797370' } }),
      ).toMatchObject({ cbu: '0170099220000067797370', cbuAlias: 'config.alias' });
    });

    it('fuera de la FCE no van CBU, alias ni transferencia, aunque estén en la config o en el estado', () => {
      const input = buildInvoiceInput(
        { ...fce, cbu: '0110599520000012345678', cbuAlias: 'escrito.alias', voucherKind: VOUCHER_KIND_MAP.fa },
        { config: { aliasCbu: 'config.alias', cbu: '0170099220000067797370' } },
      );

      expect(input.cbu).toBeUndefined();
      expect(input.cbuAlias).toBeUndefined();
      expect(input.transferMode).toBeUndefined();
    });
  });

  it('sin comprobante elegido, el flujo está mal armado', () => {
    expect(() => buildInvoiceInput(state({ voucherKind: undefined }), NO_CONFIG)).toThrow(/voucherKind/);
  });
});

describe('isFceInvoiceState', () => {
  it('solo la factura de crédito electrónica, no sus notas', () => {
    expect(isFceInvoiceState({ voucherKind: VOUCHER_KIND_MAP.fceb })).toBe(true);
    expect(isFceInvoiceState({ voucherKind: VOUCHER_KIND_MAP.nceb })).toBe(false);
    expect(isFceInvoiceState({ voucherKind: VOUCHER_KIND_MAP.fb })).toBe(false);
    expect(isFceInvoiceState({})).toBe(false);
  });
});
