import tls from 'node:tls';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchWsfexServerStatus } from '../wsfex-status';

const ANSWER =
  '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><FEXDummyResponse xmlns="http://ar.gov.afip.dif.fexv1/"><FEXDummyResult><AppServer>OK</AppServer><DbServer>D</DbServer><AuthServer>A</AuthServer></FEXDummyResult></FEXDummyResponse></soap:Body></soap:Envelope>';

/** node-soap y el WSDL del SDK de verdad, con el HTTP reemplazado. */
function answering(body: string) {
  return {
    request: vi.fn((_url: string, _xml: string, callback: (error: null, response: object, body: string) => void) => {
      callback(null, { data: body, headers: {}, status: 200, statusCode: 200 }, body);

      return {};
    }),
  };
}

describe('fetchWsfexServerStatus', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['testing', 'https://wswhomo.afip.gov.ar/wsfexv1/service.asmx'],
    ['produccion', 'https://servicios1.afip.gov.ar/wsfexv1/service.asmx'],
  ] as const)('%s: FEXDummy, sin autenticación y con la señal para cancelar', async (environment, url) => {
    const http = answering(ANSWER);
    const { signal } = new AbortController();

    expect(await fetchWsfexServerStatus(environment, signal, http as never)).toEqual({
      app: 'OK',
      auth: 'A',
      db: 'D',
    });

    const [calledUrl, xml, , headers, options] = http.request.mock.calls[0] as unknown as [
      string,
      string,
      0,
      Record<string, string>,
      object,
    ];

    expect(calledUrl).toBe(url);
    expect(xml).toContain('FEXDummy');
    expect(xml).not.toMatch(/Token|Cuit/);
    expect(headers['Content-Type']).toContain('application/soap+xml');
    expect(options).toMatchObject({ signal });
  });

  it('en producción no negocia DHE, aunque nadie haya creado antes un cliente', async () => {
    const ciphers = tls.DEFAULT_CIPHERS;

    try {
      for (const [environment, expected] of [
        ['testing', 'DEFAULT'],
        ['produccion', 'DEFAULT:!DHE'],
      ] as const) {
        tls.DEFAULT_CIPHERS = 'DEFAULT';
        await fetchWsfexServerStatus(environment, new AbortController().signal, answering(ANSWER) as never);
        expect(tls.DEFAULT_CIPHERS).toBe(expected);
      }
    } finally {
      tls.DEFAULT_CIPHERS = ciphers;
    }
  });

  it('cancelada antes de empezar, no consulta', async () => {
    const http = answering(ANSWER);

    await expect(fetchWsfexServerStatus('testing', AbortSignal.abort(), http as never)).rejects.toThrow();
    expect(http.request).not.toHaveBeenCalled();
  });
});
