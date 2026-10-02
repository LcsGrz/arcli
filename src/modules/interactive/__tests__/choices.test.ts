import { describe, expect, it } from 'vitest';

import { VOUCHER_KIND_MAP } from '../../billing/voucher-kind-map';
import { invoiceKindChoices, ivaConditionChoices, noteKindChoices, receiverChoices } from '../choices';

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

  it('en la A solo permite identificar por CUIT', () => {
    expect(receiverChoices('a').map((choice) => choice.value)).toEqual(['cuit']);
    expect(receiverChoices('b').map((choice) => choice.value)).toEqual(['consumidor-final', 'cuit', 'dni']);
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
