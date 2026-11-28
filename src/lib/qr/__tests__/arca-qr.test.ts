import { describe, expect, it } from 'vitest';

import { type ArcaQrValue, parseArcaQrUrl } from '../arca-qr';

/**
 * El QR de los comprobantes (RG 4892/2020): `https://www.arca.gob.ar/fe/qr/?p=<JSON en Base64>` o la misma URL con
 * `www.afip.gob.ar`, que usan los emitidos antes del cambio de nombre y `@arcasdk/pdf`. De ahí salen los datos que
 * `arcli constatar --qr` manda a WSCDC, ya en su formato: fecha `yyyymmdd`, CAE o CAEA y el receptor solo si lo hay.
 */

/** Como lo arma `buildArcaQrUrl` de `@arcasdk/pdf` 0.2.1: los números como números y el CAE también. */
const QR_JSON = {
  ver: 1,
  fecha: '2026-11-10',
  cuit: 30709965812,
  ptoVta: 3,
  tipoCmp: 1,
  nroCmp: 1234,
  importe: 12100,
  moneda: 'PES',
  ctz: 1,
  tipoDocRec: 80,
  nroDocRec: 20111111112,
  tipoCodAut: 'E',
  codAut: 76463926585341,
};

const AFIP_BASE = 'https://www.afip.gob.ar/fe/qr/?p=';
const ARCA_BASE = 'https://www.arca.gob.ar/fe/qr/?p=';

function base64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

function qrUrl(json: Record<string, unknown> = QR_JSON, base = AFIP_BASE): string {
  return `${base}${base64(JSON.stringify(json))}`;
}

function without(field: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(QR_JSON).filter(([key]) => key !== field));
}

const EXPECTED: ArcaQrValue = {
  authorizationCode: '76463926585341',
  currency: 'PES',
  date: '20261110',
  issuerCuit: '30709965812',
  mode: 'CAE',
  number: 1234,
  pointOfSale: 3,
  receiver: { documentNumber: '20111111112', documentType: 80 },
  total: 12100,
  voucherType: 1,
};

describe('parseArcaQrUrl', () => {
  it('lee el QR de un comprobante con CAE y lo deja como lo pide WSCDC', () => {
    expect(parseArcaQrUrl(qrUrl())).toMatchObject({ ok: true, value: EXPECTED });
  });

  it('acepta la base de ARCA y la de AFIP, que tienen los comprobantes anteriores al cambio de nombre', () => {
    expect(parseArcaQrUrl(qrUrl(QR_JSON, ARCA_BASE))).toMatchObject({ ok: true, value: EXPECTED });
    expect(parseArcaQrUrl(qrUrl(QR_JSON, AFIP_BASE))).toMatchObject({ ok: true, value: EXPECTED });
  });

  it('tipoCodAut A es un CAEA', () => {
    expect(parseArcaQrUrl(qrUrl({ ...QR_JSON, tipoCodAut: 'A' }))).toMatchObject({
      ok: true,
      value: { mode: 'CAEA' },
    });
  });

  it('sin receptor, o con el 99/0 del consumidor final que pone @arcasdk/pdf, no hay receptor', () => {
    const withoutReceiver = Object.fromEntries(
      Object.entries(QR_JSON).filter(([key]) => key !== 'tipoDocRec' && key !== 'nroDocRec'),
    );

    expect(parseArcaQrUrl(qrUrl(withoutReceiver))).toMatchObject({ ok: true, value: { receiver: null } });
    expect(parseArcaQrUrl(qrUrl({ ...QR_JSON, nroDocRec: 0, tipoDocRec: 99 }))).toMatchObject({
      ok: true,
      value: { receiver: null },
    });
  });

  it('el importe con decimales y el DNI del receptor', () => {
    expect(
      parseArcaQrUrl(qrUrl({ ...QR_JSON, importe: 1500.5, nroDocRec: 11111111, tipoCmp: 6, tipoDocRec: 96 })),
    ).toMatchObject({
      ok: true,
      value: { receiver: { documentNumber: '11111111', documentType: 96 }, total: 1500.5, voucherType: 6 },
    });
  });

  it('lee el parámetro escapado, como lo copian algunos lectores de QR (%3D en vez de =)', () => {
    const encoded = base64(JSON.stringify(QR_JSON));

    expect(encoded).toMatch(/=$/);
    expect(parseArcaQrUrl(`${AFIP_BASE}${encodeURIComponent(encoded)}`)).toMatchObject({
      ok: true,
      value: EXPECTED,
    });
  });

  describe('el + y la / del Base64', () => {
    // Un campo que el QR no define (se ignora) con texto que deja `+` y `/` en el Base64.
    const encoded = base64(JSON.stringify({ ...QR_JSON, nota: '¿ñ~ñ' }));

    it('el JSON los tiene', () => {
      expect(encoded).toMatch(/\+/);
      expect(encoded).toMatch(/\//);
    });

    it.each([
      ['tal cual', encoded],
      ['con el + como espacio, como queda al pegarlo en algunos lugares', encoded.replace(/\+/g, ' ')],
      ['con el + escapado (%2B)', encoded.replace(/\+/g, '%2B')],
    ])('lo lee %s', (_name, parameter) => {
      expect(parseArcaQrUrl(`${ARCA_BASE}${parameter}`)).toMatchObject({ ok: true, value: EXPECTED });
    });
  });

  it('acepta ver escrito como texto, como los demás numéricos', () => {
    expect(parseArcaQrUrl(qrUrl({ ...QR_JSON, ver: '1' }))).toMatchObject({ ok: true, value: EXPECTED });
  });

  it('trae la moneda, si viene', () => {
    expect(parseArcaQrUrl(qrUrl({ ...QR_JSON, moneda: 'DOL' }))).toMatchObject({ value: { currency: 'DOL' } });
    expect(parseArcaQrUrl(qrUrl(without('moneda')))).toMatchObject({ ok: true, value: { currency: null } });
  });

  it('ignora espacios y saltos de línea alrededor, como queda al pegar la URL', () => {
    expect(parseArcaQrUrl(` ${qrUrl()}\r\n`)).toMatchObject({ ok: true, value: EXPECTED });
  });

  it('rechaza una URL que no es la del QR de ARCA, y lo dice', () => {
    for (const url of [
      `https://example.com/fe/qr/?p=${base64(JSON.stringify(QR_JSON))}`,
      `https://www.arca.gob.ar.example.com/fe/qr/?p=${base64(JSON.stringify(QR_JSON))}`,
      `https://www.arca.gob.ar/otra/?p=${base64(JSON.stringify(QR_JSON))}`,
      'no es una URL',
    ]) {
      expect(parseArcaQrUrl(url), url).toEqual({
        ok: false,
        reason: expect.stringContaining('arca.gob.ar/fe/qr'),
      });
    }
  });

  it('rechaza un p que no es Base64 o no es un JSON', () => {
    for (const p of ['%%%no-es-base64%%%', base64('{"ver":1,"fecha":'), base64('[1,2,3]'), base64('hola')]) {
      expect(parseArcaQrUrl(`${ARCA_BASE}${p}`), p).toEqual({ ok: false, reason: expect.any(String) });
    }
  });

  it('rechaza una versión que no es la 1, y dice cuál vino', () => {
    expect(parseArcaQrUrl(qrUrl({ ...QR_JSON, ver: 2 }))).toEqual({
      ok: false,
      reason: expect.stringMatching(/versi[oó]n.*2/i),
    });
  });

  it.each(['ver', 'fecha', 'cuit', 'ptoVta', 'tipoCmp', 'nroCmp', 'importe', 'tipoCodAut', 'codAut'])(
    'rechaza el QR sin %s, y dice que falta ese campo',
    (field) => {
      expect(parseArcaQrUrl(qrUrl(without(field)))).toEqual({ ok: false, reason: `falta el campo ${field}` });
    },
  );

  it.each([null, ''])('un campo obligatorio en %j es un campo que falta', (value) => {
    expect(parseArcaQrUrl(qrUrl({ ...QR_JSON, fecha: value }))).toEqual({ ok: false, reason: 'falta el campo fecha' });
  });

  it.each(['cuit', 'ptoVta', 'tipoCmp', 'nroCmp', 'codAut', 'tipoDocRec', 'nroDocRec'])(
    'un %s que no es un número entero: lo rechaza y nombra el campo',
    (field) => {
      expect(parseArcaQrUrl(qrUrl({ ...QR_JSON, [field]: 'x' }))).toEqual({
        ok: false,
        reason: expect.stringContaining(`el campo ${field} tiene que ser un número entero`),
      });
    },
  );

  it('rechaza la URL http, aunque sea la de ARCA', () => {
    expect(parseArcaQrUrl(qrUrl(QR_JSON, 'http://www.arca.gob.ar/fe/qr/?p='))).toEqual({
      ok: false,
      reason: expect.stringContaining('arca.gob.ar/fe/qr'),
    });
  });

  it('dice que falta el parámetro p cuando no está o está vacío', () => {
    for (const url of ['https://www.arca.gob.ar/fe/qr/', 'https://www.arca.gob.ar/fe/qr/?p=']) {
      expect(parseArcaQrUrl(url), url).toEqual({
        ok: false,
        reason: 'le falta el parámetro p, con los datos del comprobante',
      });
    }
  });

  it.each([
    ['con un caracter que no es de Base64 al final', `${base64(JSON.stringify(QR_JSON))}!`],
    [
      'con un caracter que no es de Base64 en el medio',
      `${base64(JSON.stringify(QR_JSON)).slice(0, 8)}*${base64(JSON.stringify(QR_JSON)).slice(8)}`,
    ],
  ])('rechaza el p %s, aunque Node lo decodificaría', (_name, p) => {
    expect(parseArcaQrUrl(`${ARCA_BASE}${p}`)).toEqual({
      ok: false,
      reason: 'el parámetro p no es un texto en Base64',
    });
  });

  it.each(['null', '[1,2,3]', '7'])('un JSON que no es un objeto (%s) no trae los datos del comprobante', (json) => {
    expect(parseArcaQrUrl(`${ARCA_BASE}${base64(json)}`)).toEqual({
      ok: false,
      reason: 'el contenido del parámetro p no es un JSON con los datos del comprobante',
    });
  });

  describe('importe', () => {
    it.each<[unknown, number]>([
      ['12100', 12_100],
      ['1500.50', 1500.5],
      [0, 0],
    ])('acepta %j como %d', (importe, total) => {
      expect(parseArcaQrUrl(qrUrl({ ...QR_JSON, importe }))).toMatchObject({ ok: true, value: { total } });
    });

    it.each(['1e3', '1,5', true, '12.'])('rechaza %j', (importe) => {
      expect(parseArcaQrUrl(qrUrl({ ...QR_JSON, importe }))).toEqual({
        ok: false,
        reason: 'el campo importe tiene que ser un número mayor o igual a 0',
      });
    });
  });

  describe('los numéricos', () => {
    it.each<[string, unknown]>([
      ['con decimales', 1.5],
      ['con letras', '3a'],
      ['en una lista', [3]],
    ])('rechaza un punto de venta %s', (_name, ptoVta) => {
      expect(parseArcaQrUrl(qrUrl({ ...QR_JSON, ptoVta }))).toEqual({
        ok: false,
        reason: 'el campo ptoVta tiene que ser un número entero de hasta 5 dígitos',
      });
    });

    it('rechaza un nroDocRec numérico que ya perdió precisión (más de 15 dígitos)', () => {
      expect(parseArcaQrUrl(qrUrl({ ...QR_JSON, nroDocRec: 2 ** 53 + 2 }))).toMatchObject({ ok: false });
    });

    it('acepta el nroDocRec largo escrito como texto', () => {
      expect(parseArcaQrUrl(qrUrl({ ...QR_JSON, nroDocRec: '9007199254740994' }))).toMatchObject({
        ok: true,
        value: { receiver: { documentNumber: '9007199254740994', documentType: 80 } },
      });
    });
  });

  describe('fecha', () => {
    it.each<[string, unknown]>([
      ['con hora (date-time, no full-date)', '2026-11-10T00:00:00'],
      ['con algo antes', 'x2026-11-10'],
      ['en una lista', ['2026-11-10']],
    ])('rechaza una fecha %s', (_name, fecha) => {
      expect(parseArcaQrUrl(qrUrl({ ...QR_JSON, fecha }))).toEqual({
        ok: false,
        reason: 'el campo fecha tiene que ser una fecha AAAA-MM-DD',
      });
    });
  });

  describe('receptor', () => {
    it('tipoDocRec y nroDocRec en null es lo mismo que sin receptor', () => {
      expect(parseArcaQrUrl(qrUrl({ ...QR_JSON, nroDocRec: null, tipoDocRec: null }))).toMatchObject({
        ok: true,
        value: { receiver: null },
      });
    });

    it.each<[string, Record<string, unknown>, string]>([
      ['tipoDocRec sin nroDocRec', { nroDocRec: undefined }, 'trae tipoDocRec sin nroDocRec'],
      ['nroDocRec sin tipoDocRec', { tipoDocRec: undefined }, 'trae nroDocRec sin tipoDocRec'],
      ['tipoDocRec con nroDocRec en null', { nroDocRec: null }, 'trae tipoDocRec sin nroDocRec'],
    ])('rechaza %s', (_name, change, reason) => {
      expect(parseArcaQrUrl(qrUrl({ ...QR_JSON, ...change }))).toEqual({ ok: false, reason });
    });

    it.each<[string, Record<string, unknown>]>([
      ['el 99 con un número', { nroDocRec: 12345, tipoDocRec: 99 }],
      ['un DNI con el número 0', { nroDocRec: 0, tipoDocRec: 96 }],
    ])('%s no es un receptor', (_name, change) => {
      expect(parseArcaQrUrl(qrUrl({ ...QR_JSON, ...change }))).toMatchObject({ ok: true, value: { receiver: null } });
    });
  });

  describe('moneda', () => {
    it('la lee sin espacios y en mayúsculas', () => {
      expect(parseArcaQrUrl(qrUrl({ ...QR_JSON, moneda: ' dol ' }))).toMatchObject({ value: { currency: 'DOL' } });
    });

    it.each(['PESOS', 'XPES', 'PE'])(
      'una moneda que no tiene 3 caracteres (%s) es una moneda que no vino',
      (moneda) => {
        expect(parseArcaQrUrl(qrUrl({ ...QR_JSON, moneda }))).toMatchObject({ ok: true, value: { currency: null } });
      },
    );
  });

  it.each<[string, Record<string, unknown>]>([
    ['una fecha que no es AAAA-MM-DD', { fecha: '10/11/2026' }],
    ['una fecha que no existe', { fecha: '2026-02-31' }],
    ['un tipo de código que no es E ni A', { tipoCodAut: 'I' }],
    ['un código de autorización que no tiene 14 dígitos', { codAut: 123 }],
    ['un CUIT del emisor con el dígito verificador mal', { cuit: 30709965813 }],
    ['un número de comprobante que no es un entero positivo', { nroCmp: 0 }],
    ['un punto de venta que no es un entero positivo', { ptoVta: -3 }],
    ['un importe negativo', { importe: -1 }],
    ['un número donde va texto', { fecha: 20261110 }],
  ])('rechaza %s', (_name, change) => {
    expect(parseArcaQrUrl(qrUrl({ ...QR_JSON, ...change }))).toEqual({
      ok: false,
      reason: expect.any(String),
    });
  });
});
