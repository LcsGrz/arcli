import { describe, expect, it } from 'vitest';

import { VOUCHER_KIND_MAP } from '../../billing/voucher-kind-map';
import {
  currencyChoices,
  invoiceKindChoices,
  ivaConditionChoices,
  noteKindChoices,
  receiverChoices,
  reciboChoices,
} from '../choices';

describe('interactive choices', () => {
  it('ofrece facturas comunes y FCE', () => {
    expect(invoiceKindChoices().map((choice) => choice.value.shortcut)).toEqual([
      'fc',
      'fb',
      'fa',
      'fcec',
      'fceb',
      'fcea',
    ]);
  });

  it('ofrece los recibos aparte, de C a A, para que las notas no los listen como factura', () => {
    expect(reciboChoices().map((choice) => choice.value.shortcut)).toEqual(['rc', 'rb', 'ra']);
    expect(invoiceKindChoices().map((choice) => choice.value.shortcut)).not.toContain('rc');
    expect(invoiceKindChoices().map((choice) => choice.value.shortcut)).not.toContain('ra');
  });

  it('en la A solo permite identificar por CUIT', () => {
    expect(receiverChoices('a').map((choice) => choice.value)).toEqual(['cuit']);
    expect(receiverChoices('b').map((choice) => choice.value)).toEqual(['consumidor-final', 'cuit', 'dni', 'cuil']);
  });

  it('ofrece pesos y las monedas de ARCA con codigo ISO, sin las que solo tienen codigo numerico', () => {
    const values = currencyChoices().map((choice) => choice.value);

    expect(values.slice(0, 3)).toEqual(['PES', 'USD', 'EUR']);
    expect(values).toContain('NZD');
    expect(values).not.toContain('ARS');
    expect(values).not.toContain('002');
    expect(currencyChoices()[2]?.name).toBe('Euros (EUR)');
  });

  it('filtra el IVA receptor segun la letra', () => {
    expect(ivaConditionChoices('a').map((choice) => choice.value)).not.toContain('consumidor-final');
    expect(ivaConditionChoices('b').map((choice) => choice.value)).not.toContain('responsable-inscripto');
    expect(ivaConditionChoices('c')).toHaveLength(11);
    expect(ivaConditionChoices('a')[0]?.name).toBe('Responsable inscripto');
  });

  it('elige la nota que corresponde a la factura', () => {
    expect(noteKindChoices('credito', VOUCHER_KIND_MAP.fb).shortcut).toBe('ncb');
    expect(noteKindChoices('debito', VOUCHER_KIND_MAP.fcea).shortcut).toBe('ndea');
  });
});
