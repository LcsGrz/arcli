import { describe, expect, it } from 'vitest';

import { findRuleFailure } from '../../../lib/rules/rules';
import { resolveVoucherCheckRequest, VOUCHER_CHECK_RECEIVER_RULES, type VoucherCheckInput } from '../voucher-check';

const CUIT = { documentNumber: '20111111112', documentType: 80 };
const CUIL = { documentNumber: '20111111112', documentType: 86 };
const DNI = { documentNumber: '11111111', documentType: 96 };

type RuleInput = Parameters<(typeof VOUCHER_CHECK_RECEIVER_RULES)[number]['check']>[0];

/** La primera regla que falla, como en el CLI (`assertRules`). */
const check = (input: RuleInput) => findRuleFailure(VOUCHER_CHECK_RECEIVER_RULES, input, undefined)?.failure;

const ruleById = (id: string) => VOUCHER_CHECK_RECEIVER_RULES.find((rule) => rule.id === id)!;

describe('VOUCHER_CHECK_RECEIVER_RULES (WSCDC v0.4, observaciones 113 a 118)', () => {
  // Clase A, A con leyenda "Operación sujeta a retención" (51 a 54; no son la M) y FCE: tabla de tipos de WSFE.
  it.each([1, 2, 3, 4, 5, 34, 39, 60, 63, 51, 52, 53, 54, 201, 202, 203, 206, 207, 208, 211, 212, 213])(
    'el tipo %i pide el CUIT del receptor',
    (voucherType) => {
      expect(check({ receiver: null, totalInPesos: 1, voucherType })).toEqual({
        message: expect.stringContaining('`--cuit`'),
        question: expect.not.stringContaining('--'),
      });
      expect(check({ receiver: CUIT, totalInPesos: 1, voucherType })).toBeUndefined();
    },
  );

  it('el texto del asistente no nombra flags: dice qué documento no sirve', () => {
    expect(check({ receiver: DNI, totalInPesos: 1, voucherType: 206 })).toEqual({
      message:
        'La factura de crédito electrónica B se constata con el CUIT del receptor: usá `--cuit` en vez de `--dni`.',
      question: 'La factura de crédito electrónica B se constata con el CUIT del receptor, no con DNI.',
    });
  });

  it('un documento que ARCLI no nombra (el pasaporte de un QR) se nombra con su código', () => {
    const receiver = { documentNumber: '12345678', documentType: 94 };

    expect(check({ receiver, totalInPesos: 1, voucherType: 206 })).toMatchObject({
      question: 'La factura de crédito electrónica B se constata con el CUIT del receptor, no con el documento 94.',
    });
  });

  it('el receptor que todavía no se preguntó (sin definir) no falla: el CLI pasa null', () => {
    expect(check({ totalInPesos: 1, voucherType: 1 })).toBeUndefined();
    expect(check({ totalInPesos: 20_000_000, voucherType: 6 })).toBeUndefined();
  });

  it('el CUIT y la T leen solo el receptor; el tope, el receptor y el importe', () => {
    expect(ruleById('voucher-check-receiver-document').fields).toEqual(['receiver']);
    expect(ruleById('voucher-check-receiver-threshold').fields).toEqual(['receiver', 'totalInPesos']);
  });

  it.each([6, 7, 8, 9, 10, 35, 40, 61, 64, 11, 12, 13, 15, 30, 31, 37, 38, 41, 49])(
    'el tipo %i pide el documento solo si el importe supera $ 10.000.000',
    (voucherType) => {
      expect(check({ receiver: null, totalInPesos: 10_000_000, voucherType })).toBeUndefined();
      expect(check({ receiver: null, totalInPesos: 10_000_000.01, voucherType })).toMatchObject({
        question: expect.stringContaining('de más de $ 10.000.000 se constata con el documento del receptor.'),
      });
      expect(check({ receiver: DNI, totalInPesos: 20_000_000, voucherType })).toBeUndefined();
    },
  );

  it('nombra el comprobante: el que ARCLI emite por su nombre y el otro por su código', () => {
    expect(check({ receiver: null, totalInPesos: 20_000_000, voucherType: 15 })).toMatchObject({
      question: 'El recibo C de más de $ 10.000.000 se constata con el documento del receptor.',
    });
    expect(check({ receiver: null, totalInPesos: 20_000_000, voucherType: 49 })).toMatchObject({
      question: 'El comprobante tipo 49 de más de $ 10.000.000 se constata con el documento del receptor.',
    });
  });

  it('sin el importe en pesos (un QR en otra moneda) el tope lo controla ARCA', () => {
    expect(check({ receiver: null, totalInPesos: null, voucherType: 6 })).toBeUndefined();
  });

  it('sin el importe todavía (el asistente pregunta el receptor antes) no pide el documento por el tope', () => {
    expect(check({ receiver: null, voucherType: 6 })).toBeUndefined();
  });

  it.each([195, 196, 197])('un comprobante T (%i) no va con CUIL; sin receptor lo decide ARCA', (voucherType) => {
    expect(check({ receiver: CUIL, totalInPesos: 1, voucherType })).toEqual({
      message: expect.stringContaining('en vez de `--cuil`'),
      question: `El comprobante tipo ${voucherType} (turismo) va con CUIT, CI extranjera, pasaporte o DNI del receptor, no con CUIL.`,
    });
    expect(check({ receiver: DNI, totalInPesos: 1, voucherType })).toBeUndefined();
    expect(check({ receiver: null, totalInPesos: 1, voucherType })).toBeUndefined();
  });

  it.each([19, 99, 999])('un tipo que la tabla no clasifica (%i) lo decide ARCA', (voucherType) => {
    expect(check({ receiver: null, totalInPesos: 20_000_000, voucherType })).toBeUndefined();
  });
});

/** 17/11/2026 al mediodía de Buenos Aires: resuelve las fechas sin año. */
const NOW = new Date('2026-11-17T15:00:00Z');
const ISSUER = '30709965812';
const CAE = '76463926585341';

/** Una Factura A recibida, como llega de los flags: los CUIT y el monto ya los leyó cada flag. */
const FA: VoucherCheckInput = {
  amount: 12100,
  cae: CAE,
  cuit: CUIT.documentNumber,
  date: '10/11/2026',
  issuer: ISSUER,
  kind: 'fa',
  voucher: '3-1234',
};

/** Una Factura B sin receptor. */
const FB: VoucherCheckInput = { ...FA, cuit: undefined, kind: 'fb' };

const resolve = (input: VoucherCheckInput) => resolveVoucherCheckRequest(input, NOW);

/** El QR como lo arma `@arcasdk/pdf`, con la Factura A de `FA`. */
function qr(json: Record<string, unknown> = {}): string {
  const content = {
    ver: 1,
    fecha: '2026-11-10',
    cuit: Number(ISSUER),
    ptoVta: 3,
    tipoCmp: 1,
    nroCmp: 1234,
    importe: 12100,
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: 80,
    nroDocRec: Number(CUIT.documentNumber),
    tipoCodAut: 'E',
    codAut: Number(CAE),
    ...json,
  };

  return `https://www.arca.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(content)).toString('base64')}`;
}

/** Una B de consumidor final (99/0) por ese importe y en esa moneda (sin moneda, si no se da). */
const qrB = (importe: number, moneda?: string) => qr({ importe, moneda, nroDocRec: 0, tipoCmp: 6, tipoDocRec: 99 });

describe('resolveVoucherCheckRequest: el tipo y el comprobante', () => {
  it('ignora los espacios alrededor del tipo, del comprobante y del código, como al pegarlos', () => {
    expect(resolve({ ...FA, cae: ` ${CAE} `, kind: ' fa ', voucher: ' 3-1234 ' })).toMatchObject({
      authorizationCode: CAE,
      number: 1234,
      pointOfSale: 3,
      shortcut: 'fa',
      voucherType: 1,
    });
  });

  it('el código 999 (el más alto de 3 dígitos) se constata: la lista la tiene ARCA', () => {
    expect(resolve({ ...FB, kind: '999' })).toMatchObject({ shortcut: null, voucherType: 999 });
  });

  it.each(['1e2', '0x1', '1.5'])('el tipo %s no es un código de ARCA', (kind) => {
    expect(() => resolve({ ...FB, kind })).toThrow(`El tipo de comprobante "${kind}" no es válido.`);
  });

  it('el punto de venta 1 y el número 1 son válidos', () => {
    expect(resolve({ ...FA, voucher: '1-1' })).toMatchObject({ number: 1, pointOfSale: 1 });
  });

  it.each(['x3-1234', '3-1234x'])('%s no es un comprobante', (voucher) => {
    expect(() => resolve({ ...FA, voucher })).toThrow(`El comprobante "${voucher}" no es válido`);
  });
});

describe('resolveVoucherCheckRequest: el receptor', () => {
  it('el DNI con puntos se manda solo con los dígitos', () => {
    expect(resolve({ ...FB, dni: '11.111.111' })).toMatchObject({
      receiver: { documentNumber: '11111111', documentType: 96 },
    });
  });

  it('un DNI de menos de 6 dígitos no es válido, y lo dice', () => {
    expect(() => resolve({ ...FB, dni: '123' })).toThrow('El DNI "123" no es válido');
  });
});

describe('resolveVoucherCheckRequest: fecha e importe', () => {
  it('el 1/1/2013 es la primera fecha que se constata', () => {
    expect(resolve({ ...FA, date: '01/01/2013' })).toMatchObject({ date: '20130101' });
  });

  it.each(['mes-pasado', 'mes-actual'])('-f %s es un mes, no un día: no se constata', (date) => {
    expect(() => resolve({ ...FA, date })).toThrow('es un mes y esta fecha es de un día');
  });

  it('el importe de más de 13 enteros dice el máximo que acepta ARCA', () => {
    expect(() => resolve({ ...FA, amount: 10_000_000_000_000 })).toThrow('(9.999.999.999.999,99)');
  });
});

describe('resolveVoucherCheckRequest: --qr', () => {
  it('el punto de venta del QR va hasta 99998, como el de los flags', () => {
    expect(resolve({ qr: qr({ ptoVta: 99_998 }) })).toMatchObject({ pointOfSale: 99_998 });
    expect(() => resolve({ qr: qr({ ptoVta: 99_999 }) })).toThrow(
      'El QR no se puede constatar: el punto de venta va de 1 a 99998.',
    );
  });

  it('una B sobre el tope sin receptor: en pesos o sin moneda corta antes; en otra moneda lo decide ARCA', () => {
    expect(() => resolve({ qr: qrB(20_000_000, 'PES') })).toThrow(/de más de \$ 10\.000\.000/);
    expect(() => resolve({ qr: qrB(20_000_000) })).toThrow(/de más de \$ 10\.000\.000/);
    expect(resolve({ qr: qrB(20_000_000, 'DOL') })).toMatchObject({
      currency: 'DOL',
      receiver: null,
      total: 20_000_000,
    });
  });
});
