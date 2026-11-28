import { describe, expect, it } from 'vitest';

import { VOUCHER_KIND_MAP } from '../../billing/voucher-kind-map';
import { VOUCHER_CHECK_RECEIVER_RULE } from '../voucher-check';

const CUIT = { documentNumber: '20111111112', documentType: 80 };
const DNI = { documentNumber: '11111111', documentType: 96 };

describe('VOUCHER_CHECK_RECEIVER_RULE (WSCDC v0.4, observaciones 113 a 116)', () => {
  const check = (input: Parameters<typeof VOUCHER_CHECK_RECEIVER_RULE.check>[0]) =>
    VOUCHER_CHECK_RECEIVER_RULE.check(input, undefined);

  it.each(['fa', 'nca', 'fcea', 'fceb', 'fcec', 'ndeb'] as const)('en %s pide el CUIT del receptor', (shortcut) => {
    expect(check({ kind: VOUCHER_KIND_MAP[shortcut], receiver: null, total: 1 })).toEqual({
      message: expect.stringContaining('`--cuit`'),
      question: expect.not.stringContaining('--'),
    });
    expect(check({ kind: VOUCHER_KIND_MAP[shortcut], receiver: CUIT, total: 1 })).toBeUndefined();
  });

  it('el texto del asistente no nombra flags: dice qué documento no sirve', () => {
    expect(check({ kind: VOUCHER_KIND_MAP.fceb, receiver: DNI, total: 1 })).toEqual({
      message:
        'La factura de crédito electrónica B se constata con el CUIT del receptor: usá `--cuit` en vez de `--dni`.',
      question: 'La factura de crédito electrónica B se constata con el CUIT del receptor, no con DNI.',
    });
  });

  it('en B y C comunes, solo más de $ 10.000.000 pide el documento', () => {
    expect(check({ kind: VOUCHER_KIND_MAP.fb, receiver: null, total: 10_000_000 })).toBeUndefined();
    expect(check({ kind: VOUCHER_KIND_MAP.rc, receiver: null, total: 10_000_000.01 })).toMatchObject({
      question: 'El recibo C de más de $ 10.000.000 se constata con el documento del receptor.',
    });
    expect(check({ kind: VOUCHER_KIND_MAP.fc, receiver: DNI, total: 20_000_000 })).toBeUndefined();
  });

  it('un tipo que ARCLI no emite lo decide ARCA', () => {
    expect(check({ kind: null, receiver: null, total: 20_000_000 })).toBeUndefined();
  });
});
