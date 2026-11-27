import { describe, expect, it } from 'vitest';

/**
 * El QR de los comprobantes (RG 4892/2020): `https://www.arca.gob.ar/fe/qr/?p=<JSON en Base64>` o la misma URL con
 * `www.afip.gob.ar`, que usan los emitidos antes del cambio de nombre y `@arcasdk/pdf`. De ahí salen los datos que
 * `arcli constatar --qr` manda a WSCDC, ya en su formato: fecha `yyyymmdd`, CAE o CAEA y el receptor solo si lo hay.
 *
 * Tests primero (SDK-10): el módulo todavía no existe. Se carga con un `import()` de ruta variable para que el
 * typecheck pase hoy; al implementarlo, pasá a `import { parseArcaQrUrl } from '../arca-qr'` y cada `it.fails` a `it`.
 */
interface ArcaQrValue {
  readonly authorizationCode: string;
  readonly date: string;
  readonly issuerCuit: string;
  readonly mode: 'CAE' | 'CAEA';
  readonly number: number;
  readonly pointOfSale: number;
  readonly receiver: { readonly documentNumber: string; readonly documentType: number } | null;
  readonly total: number;
  readonly voucherType: number;
}

type ArcaQrParseResult =
  { readonly ok: true; readonly value: ArcaQrValue } | { readonly ok: false; readonly reason: string };

const MODULE = '../arca-qr';

async function parseArcaQrUrl(text: string): Promise<ArcaQrParseResult> {
  const module = (await import(/* @vite-ignore */ MODULE).catch((error: unknown) =>
    expect.fail(`Falta src/lib/qr/arca-qr.ts con parseArcaQrUrl: ${String(error)}`),
  )) as { readonly parseArcaQrUrl?: (text: string) => ArcaQrParseResult };

  expect(module.parseArcaQrUrl, 'src/lib/qr/arca-qr.ts exporta parseArcaQrUrl').toBeTypeOf('function');

  return module.parseArcaQrUrl!(text);
}

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
  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('lee el QR de un comprobante con CAE y lo deja como lo pide WSCDC', async () => {
    expect(await parseArcaQrUrl(qrUrl())).toMatchObject({ ok: true, value: EXPECTED });
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails(
    'acepta la base de ARCA y la de AFIP, que tienen los comprobantes anteriores al cambio de nombre',
    async () => {
      expect(await parseArcaQrUrl(qrUrl(QR_JSON, ARCA_BASE))).toMatchObject({ ok: true, value: EXPECTED });
      expect(await parseArcaQrUrl(qrUrl(QR_JSON, AFIP_BASE))).toMatchObject({ ok: true, value: EXPECTED });
    },
  );

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('tipoCodAut A es un CAEA', async () => {
    expect(await parseArcaQrUrl(qrUrl({ ...QR_JSON, tipoCodAut: 'A' }))).toMatchObject({
      ok: true,
      value: { mode: 'CAEA' },
    });
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('sin receptor, o con el 99/0 del consumidor final que pone @arcasdk/pdf, no hay receptor', async () => {
    const withoutReceiver = Object.fromEntries(
      Object.entries(QR_JSON).filter(([key]) => key !== 'tipoDocRec' && key !== 'nroDocRec'),
    );

    expect(await parseArcaQrUrl(qrUrl(withoutReceiver))).toMatchObject({ ok: true, value: { receiver: null } });
    expect(await parseArcaQrUrl(qrUrl({ ...QR_JSON, nroDocRec: 0, tipoDocRec: 99 }))).toMatchObject({
      ok: true,
      value: { receiver: null },
    });
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('el importe con decimales y el DNI del receptor', async () => {
    expect(
      await parseArcaQrUrl(qrUrl({ ...QR_JSON, importe: 1500.5, nroDocRec: 11111111, tipoCmp: 6, tipoDocRec: 96 })),
    ).toMatchObject({
      ok: true,
      value: { receiver: { documentNumber: '11111111', documentType: 96 }, total: 1500.5, voucherType: 6 },
    });
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('lee el parámetro escapado, como lo copian algunos lectores de QR (%3D en vez de =)', async () => {
    const encoded = base64(JSON.stringify(QR_JSON));

    expect(encoded).toMatch(/=$/);
    expect(await parseArcaQrUrl(`${AFIP_BASE}${encodeURIComponent(encoded)}`)).toMatchObject({
      ok: true,
      value: EXPECTED,
    });
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('ignora espacios y saltos de línea alrededor, como queda al pegar la URL', async () => {
    expect(await parseArcaQrUrl(` ${qrUrl()}\r\n`)).toMatchObject({ ok: true, value: EXPECTED });
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('rechaza una URL que no es la del QR de ARCA, y lo dice', async () => {
    for (const url of [
      `https://example.com/fe/qr/?p=${base64(JSON.stringify(QR_JSON))}`,
      `https://www.arca.gob.ar.example.com/fe/qr/?p=${base64(JSON.stringify(QR_JSON))}`,
      `https://www.arca.gob.ar/otra/?p=${base64(JSON.stringify(QR_JSON))}`,
      'no es una URL',
    ]) {
      expect(await parseArcaQrUrl(url), url).toEqual({
        ok: false,
        reason: expect.stringContaining('arca.gob.ar/fe/qr'),
      });
    }
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('rechaza la URL sin el parámetro p', async () => {
    expect(await parseArcaQrUrl('https://www.arca.gob.ar/fe/qr/')).toEqual({
      ok: false,
      reason: expect.any(String),
    });
    expect(await parseArcaQrUrl('https://www.arca.gob.ar/fe/qr/?p=')).toEqual({
      ok: false,
      reason: expect.any(String),
    });
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('rechaza un p que no es Base64 o no es un JSON', async () => {
    for (const p of ['%%%no-es-base64%%%', base64('{"ver":1,"fecha":'), base64('[1,2,3]'), base64('hola')]) {
      expect(await parseArcaQrUrl(`${ARCA_BASE}${p}`), p).toEqual({ ok: false, reason: expect.any(String) });
    }
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('rechaza una versión que no es la 1, y dice cuál vino', async () => {
    expect(await parseArcaQrUrl(qrUrl({ ...QR_JSON, ver: 2 }))).toEqual({
      ok: false,
      reason: expect.stringMatching(/versi[oó]n.*2/i),
    });
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each(['ver', 'fecha', 'cuit', 'ptoVta', 'tipoCmp', 'nroCmp', 'importe', 'tipoCodAut', 'codAut'])(
    'rechaza el QR sin %s, y nombra el campo',
    async (field) => {
      expect(await parseArcaQrUrl(qrUrl(without(field)))).toEqual({
        ok: false,
        reason: expect.stringContaining(field),
      });
    },
  );

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each<[string, Record<string, unknown>]>([
    ['una fecha que no es AAAA-MM-DD', { fecha: '10/11/2026' }],
    ['una fecha que no existe', { fecha: '2026-02-31' }],
    ['un tipo de código que no es E ni A', { tipoCodAut: 'I' }],
    ['un código de autorización que no tiene 14 dígitos', { codAut: 123 }],
    ['un CUIT del emisor con el dígito verificador mal', { cuit: 30709965813 }],
    ['un número de comprobante que no es un entero positivo', { nroCmp: 0 }],
    ['un punto de venta que no es un entero positivo', { ptoVta: -3 }],
    ['un importe negativo', { importe: -1 }],
    ['un número donde va texto', { fecha: 20261110 }],
  ])('rechaza %s', async (_name, change) => {
    expect(await parseArcaQrUrl(qrUrl({ ...QR_JSON, ...change }))).toEqual({
      ok: false,
      reason: expect.any(String),
    });
  });
});
