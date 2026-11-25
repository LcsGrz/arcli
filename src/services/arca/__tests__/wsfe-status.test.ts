import tls from 'node:tls';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchWsfeServerStatus } from '../wsfe-status';

const ANSWER =
  '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><FEDummyResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FEDummyResult><AppServer>OK</AppServer><DbServer>D</DbServer><AuthServer>A</AuthServer></FEDummyResult></FEDummyResponse></soap:Body></soap:Envelope>';

/** node-soap y el WSDL del SDK de verdad, con el HTTP reemplazado. */
function answering(body: string) {
  return {
    request: vi.fn((_url: string, _xml: string, callback: (error: null, response: object, body: string) => void) => {
      callback(null, { data: body, headers: {}, status: 200, statusCode: 200 }, body);

      return {};
    }),
  };
}

describe('fetchWsfeServerStatus', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['testing', 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx'],
    ['produccion', 'https://servicios1.afip.gov.ar/wsfev1/service.asmx'],
  ] as const)('%s: FEDummy, sin autenticación y con la señal para cancelar', async (environment, url) => {
    const http = answering(ANSWER);
    const { signal } = new AbortController();

    expect(await fetchWsfeServerStatus(environment, signal, http as never)).toEqual({
      app: 'OK',
      auth: 'A',
      db: 'D',
    });

    const [calledUrl, xml, , , options] = http.request.mock.calls[0] as unknown as [string, string, 0, 0, object];

    expect(calledUrl).toBe(url);
    expect(xml).toContain('FEDummy');
    expect(xml).not.toMatch(/Token|Cuit/);
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
        await fetchWsfeServerStatus(environment, new AbortController().signal, answering(ANSWER) as never);
        expect(tls.DEFAULT_CIPHERS).toBe(expected);
      }
    } finally {
      tls.DEFAULT_CIPHERS = ciphers;
    }
  });

  it('cancelada antes de empezar, no consulta', async () => {
    const http = answering(ANSWER);

    await expect(fetchWsfeServerStatus('testing', AbortSignal.abort(), http as never)).rejects.toThrow();
    expect(http.request).not.toHaveBeenCalled();
  });
});
