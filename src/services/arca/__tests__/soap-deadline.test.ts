import { MemoryTicketStorage } from '@arcasdk/core';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { isConnectionError } from '../../../lib/errors/connection-error';
import { isTolerableTableError } from '../../../modules/export/export.tables';
import { useArcaDeadlines } from '../../../testing/arca-deadlines';
import { ArcaBillingGateway } from '../arca-billing.gateway';
import { ArcaClientFactory } from '../arca-client.factory';
import { ArcaFceObligationGateway } from '../arca-fce-obligation.gateway';
import { ArcaPadronGateway } from '../arca-padron.gateway';
import { ArcaVoucherHistoryGateway } from '../arca-voucher-history.gateway';
import { fetchWsfeServerStatus } from '../wsfe-status';
import { fetchWsfexServerStatus } from '../wsfex-status';

import { createSoapArca } from './arca-soap.fixture';

/**
 * ARQ-11: ninguna llamada a ARCA queda colgada sin límite. Corre todo de verdad (SDK, node-soap, axios y TLS) contra un
 * ARCA local que no contesta o que gotea; los plazos se acortan 100 veces (`src/testing/arca-server.ts`).
 */
vi.setConfig({ testTimeout: 30_000 });

const arca = useArcaDeadlines();

const QUERY_MS = 30_000;
const WSAA_MS = 60_000;
const EMISSION_MS = 120_000;

const CUIT = 20123456786;
const CLIENT_CUIT = 30709965812;

const VOUCHER = {
  CantReg: 1,
  CbteDesde: 42,
  CbteFch: '20261117',
  CbteHasta: 42,
  CbteTipo: 11,
  Concepto: 1,
  CondicionIVAReceptorId: 5,
  DocNro: 0,
  DocTipo: 99,
  ImpIVA: 0,
  ImpNeto: 1000,
  ImpOpEx: 0,
  ImpTotal: 1000,
  ImpTotConc: 0,
  ImpTrib: 0,
  MonCotiz: 1,
  MonId: 'PES',
  PtoVta: 3,
} as never;

/** El almacenamiento en memoria del SDK es del proceso: con un CUIT por fábrica, cada una pide su ticket. */
let lastCuit = CUIT;

function runtime() {
  const { certPath, keyPath, server } = arca;

  lastCuit += 1;

  return {
    certificateExpiry: undefined,
    config: { cert: { testing: certPath }, key: { testing: keyPath } },
    context: {
      cert: server.cert,
      cuit: lastCuit,
      key: server.key,
      production: false,
      ticketStorage: new MemoryTicketStorage({ cuit: lastCuit, production: false }),
    },
    environment: 'testing',
  } as never;
}

const client = () => new ArcaClientFactory().create(runtime());
const exportGateway = () => new ArcaClientFactory().createExportGateway(runtime());
const getLastNumber = () => new ArcaVoucherHistoryGateway(client()).getLastNumber(3, 11);
const never = () => new AbortController().signal;

interface Call {
  readonly ms: number;
  /** El plazo de lo que se pide después del login. */
  readonly next?: number;
  readonly operation: string;
  readonly run: () => Promise<unknown>;
  /** El servicio del SDK, como lo nombra `Arca`, o quién hace el pedido. */
  readonly service: string;
  /** Si antes hay que pedir un ticket. */
  readonly withLogin?: boolean;
}

const CALLS: readonly Call[] = [
  {
    ms: QUERY_MS,
    operation: 'FECompUltimoAutorizado',
    run: getLastNumber,
    service: 'electronicBillingService',
    withLogin: true,
  },
  {
    ms: EMISSION_MS,
    operation: 'FECAESolicitar',
    run: () => new ArcaBillingGateway(client()).createVoucher(VOUCHER),
    service: 'electronicBillingService',
    withLogin: true,
  },
  {
    ms: QUERY_MS,
    operation: 'FECompConsultar',
    run: () => new ArcaVoucherHistoryGateway(client()).getVoucher(1, 3, 11),
    service: 'genericService',
    withLogin: true,
  },
  {
    ms: QUERY_MS,
    operation: 'FEXGetPARAM_DST_pais',
    run: () => exportGateway().getDestinationCountries(),
    service: 'wsfexService',
    withLogin: true,
  },
  {
    ms: QUERY_MS,
    operation: 'FEXGetLast_CMP',
    run: () => exportGateway().getLastVoucherNumber(19, 3),
    service: 'wsfexService',
    withLogin: true,
  },
  {
    ms: EMISSION_MS,
    operation: 'FEXAuthorize',
    run: () => exportGateway().authorize({ Cbte_nro: 8, Id: 42 } as never),
    service: 'wsfexService',
    withLogin: true,
  },
  {
    ms: QUERY_MS,
    operation: 'consultarMontoObligadoRecepcion',
    run: () => new ArcaFceObligationGateway(client()).getObligation(CLIENT_CUIT, '20261101'),
    service: 'wsfecredService',
    withLogin: true,
  },
  {
    ms: QUERY_MS,
    operation: 'getPersona_v2',
    run: () => new ArcaPadronGateway(client()).getTaxpayer(CLIENT_CUIT),
    service: 'registerInscriptionProofService',
    withLogin: true,
  },
  { ms: WSAA_MS, next: QUERY_MS, operation: 'loginCms', run: getLastNumber, service: 'WSAA, desde el cliente' },
  {
    ms: WSAA_MS,
    next: QUERY_MS,
    operation: 'loginCms',
    run: () => exportGateway().getLastVoucherNumber(19, 3),
    service: 'WSAA, desde AuthRepository',
  },
  {
    ms: QUERY_MS,
    operation: 'FEDummy',
    run: () => fetchWsfeServerStatus('testing', never()),
    service: 'SoapClient',
  },
  {
    ms: QUERY_MS,
    operation: 'FEXDummy',
    run: () => fetchWsfexServerStatus('testing', never()),
    service: 'SoapClient',
  },
];

const plannedMs = ({ ms, next, withLogin }: Call) => [
  ...(withLogin ? [WSAA_MS] : []),
  ms,
  ...(next === undefined ? [] : [next]),
];

describe.each(CALLS)('$service: $operation', (call) => {
  const { ms, operation, run } = call;

  it('si ARCA contesta, anda como siempre', async () => {
    expect(await arca.settle(run())).toMatchObject({ end: 'contestó' });
    expect(arca.server.count(operation)).toBe(1);
  });

  // Tests primero (ARQ-11): pasa a it() al implementarlo.
  it.fails.each(['cuelga', 'gotea'] as const)(
    'si ARCA %s, se corta en el plazo y no se reintenta',
    async (behavior) => {
      arca.server.respond((name) => (name === operation ? behavior : undefined));

      const settled = await arca.settle(run());

      expect(settled).toMatchObject({ end: 'se cortó' });

      const { message } = (settled as { error: Error }).error;

      expect(message).toContain(`no contestó en ${ms / 1000} segundos`);
      expect(message).not.toMatch(/no se emitió/i);
      expect(arca.server.count(operation)).toBe(1);
      // El pedido se cortó de verdad: no queda una conexión esperando.
      await vi.waitFor(() => expect(arca.server.requests.at(-1)?.dropped).toBe(true));
    },
  );

  // Tests primero (ARQ-11): pasa a it() al implementarlo.
  it.fails('el plazo de cada pedido, uno solo por pedido', async () => {
    await arca.settle(run());
    expect(arca.deadlines.map((deadline) => deadline.ms)).toEqual(plannedMs(call));
  });
});

describe('las operaciones que no están en la tabla', () => {
  // Tests primero (ARQ-11): pasa a it() al implementarlo.
  it.fails.each([
    'FEParamGetTiposPaises',
    // Parecidas a las que emiten, pero no son.
    'FECAEASolicitar',
    'FECAEAConsultar',
  ])('%s: 30 segundos', async (operation) => {
    await arca.settle(client().genericService.call('wsfe', operation, {}));
    expect(arca.deadlines.map(({ ms }) => ms)).toEqual([WSAA_MS, QUERY_MS]);
  });
});

/** Los `.ts` de producción de `src/services`. */
function serviceSources(): string {
  const root = resolve('src/services');

  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.ts') && !path.includes('__tests__'))
    .map((path) => readFileSync(join(root, path), 'utf8'))
    .join('\n');
}

describe('contrato', () => {
  it('cada servicio del SDK que usa ARCLI está en los casos de arriba', () => {
    const used = [...serviceSources().matchAll(/\b(?:arca|client)\s*(?:\.|\['|\[')\s*(\w+Service)\b/g)].map(
      ([, service]) => service,
    );
    const sdkClasses = [...serviceSources().matchAll(/\bnew (Arca|AuthRepository|SoapClient)\(/g)].map(
      ([, name]) => name,
    );

    expect([...new Set(used)].sort()).toEqual(
      [...new Set(CALLS.map(({ service }) => service))].filter((service) => service.endsWith('Service')).sort(),
    );
    // Las tres formas de llegar a ARCA. Una nueva entra acá y en los casos.
    expect([...new Set(sdkClasses)].sort()).toEqual(['Arca', 'AuthRepository', 'SoapClient']);
  });

  // Tests primero (ARQ-11): pasa a it() al implementarlo.
  it.fails('crear más clientes no suma plazos: uno por pedido', async () => {
    client();
    exportGateway();
    await fetchWsfeServerStatus('testing', never());
    client();

    const before = arca.deadlines.length;

    await fetchWsfexServerStatus('testing', never());
    expect(arca.deadlines.slice(before).map(({ ms }) => ms)).toEqual([QUERY_MS]);
  });
});

describe('el error de un plazo vencido', () => {
  async function expire(operation: string, run: () => Promise<unknown>): Promise<unknown> {
    arca.server.respond((name) => (name === operation ? 'cuelga' : undefined));

    const settled = await arca.settle(run());

    expect(settled).toMatchObject({ end: 'se cortó' });

    return (settled as { error: unknown }).error;
  }

  // Tests primero (ARQ-11): pasa a it() al implementarlo.
  it.fails('el texto de una consulta', async () => {
    expect(await expire('FECompUltimoAutorizado', getLastNumber)).toMatchObject({
      message: 'ARCA no contestó en 30 segundos.',
    });
  });

  // Tests primero (ARQ-11): pasa a it() al implementarlo.
  it.fails.each([
    ['una tabla de la E', 'FEXGetPARAM_DST_pais', () => exportGateway().getDestinationCountries()],
    [
      'el régimen FCE',
      'consultarMontoObligadoRecepcion',
      () => new ArcaFceObligationGateway(client()).getObligation(CLIENT_CUIT, '20261101'),
    ],
    ['el padrón', 'getPersona_v2', () => new ArcaPadronGateway(client()).getTaxpayer(CLIENT_CUIT)],
    ['la cotización', 'FEParamGetCotizacion', () => new ArcaBillingGateway(client()).getQuotation('DOL', '20261109')],
  ] as const)('%s: es un error de conexión', async (_name, operation, run) => {
    const error = await expire(operation, run);

    expect(isConnectionError(error)).toBe(true);
    expect(isTolerableTableError(error)).toBe(true);
  });

  // Tests primero (ARQ-11): pasa a it() al implementarlo.
  it.fails.each([
    ['desde el cliente', getLastNumber],
    ['desde AuthRepository', () => exportGateway().getLastVoucherNumber(19, 3)],
    ['antes de una tabla de la E', () => exportGateway().getUnits()],
  ] as const)('el de WSAA, %s, no: corta', async (_name, run) => {
    const error = await expire('loginCms', run);

    expect((error as Error).message).toContain('no contestó en 60 segundos');
    expect(isConnectionError(error)).toBe(false);
    expect(isTolerableTableError(error)).toBe(false);
    // No se emite ni se consulta nada con un login que no salió, ni se vuelve a pedir.
    expect(arca.server.requests.map(({ operation }) => operation)).toEqual(['loginCms']);
  });

  // Tests primero (ARQ-11): pasa a it() al implementarlo.
  it.fails('dos logins vencidos no comparten estado: el segundo pedido vuelve a pedir el ticket', async () => {
    const gateway = exportGateway();

    await expire('loginCms', () => gateway.getUnits());
    arca.server.respond(() => undefined);
    expect(await arca.settle(gateway.getUnits())).toMatchObject({ end: 'contestó' });
    expect(arca.server.count('loginCms')).toBe(2);
  });

  it('el corte de otro no se confunde con el plazo', async () => {
    const controller = new AbortController();

    arca.server.respond(() => 'cuelga');

    const call = arca.settle(fetchWsfeServerStatus('testing', controller.signal));

    await vi.waitFor(() => expect(arca.server.count('FEDummy')).toBe(1));
    controller.abort();

    const settled = await call;

    expect(settled).toMatchObject({ end: 'se cortó', error: { code: 'ERR_CANCELED' } });
    expect((settled as { error: Error }).error.message).not.toContain('no contestó');
    expect(isConnectionError((settled as { error: Error }).error)).toBe(false);
    await vi.waitFor(() => expect(arca.server.requests.at(-1)?.dropped).toBe(true));
  });

  // Tests primero (ARQ-11): pasa a it() al implementarlo.
  it.fails('cortado por otro, el plazo no queda pendiente', async () => {
    const controller = new AbortController();

    arca.server.respond(() => 'cuelga');

    const call = arca.settle(fetchWsfexServerStatus('testing', controller.signal));

    await vi.waitFor(() => expect(arca.server.count('FEXDummy')).toBe(1));
    controller.abort();
    await call;
    expect(arca.deadlines).toEqual([{ ms: QUERY_MS, state: 'cancelado' }]);
  });
});

describe('una respuesta antes del plazo', () => {
  it('poco antes: llega y no cambia nada', async () => {
    arca.server.respond((operation) => (operation === 'FECompUltimoAutorizado' ? 150 : undefined));

    expect(await arca.settle(getLastNumber())).toEqual({ end: 'contestó', value: 41 });
  });

  // Tests primero (ARQ-11): pasa a it() al implementarlo.
  it.fails('no deja plazos pendientes: ni con respuesta ni con un error de red', async () => {
    await getLastNumber();
    expect(arca.deadlines).toEqual([
      { ms: WSAA_MS, state: 'cancelado' },
      { ms: QUERY_MS, state: 'cancelado' },
    ]);

    arca.server.respond((operation) => (operation === 'FECompUltimoAutorizado' ? 'cuelga' : undefined));

    const call = arca.settle(getLastNumber());

    await vi.waitFor(() => expect(arca.server.count('FECompUltimoAutorizado')).toBe(2));
    arca.server.drop();
    expect(await call).toMatchObject({ end: 'se cortó', error: { message: 'socket hang up' } });
    expect(arca.deadlines.slice(2).map(({ state }) => state)).toEqual(['cancelado', 'cancelado']);
  });

  it('la red caída da el error de siempre, y cuenta como de conexión', async () => {
    arca.server.respond(() => 'cuelga');

    const call = arca.settle(fetchWsfeServerStatus('testing', never()));

    await vi.waitFor(() => expect(arca.server.count('FEDummy')).toBe(1));
    arca.server.drop();

    const settled = await call;

    expect(settled).toMatchObject({ end: 'se cortó', error: { message: 'socket hang up' } });
    expect(isConnectionError((settled as { error: Error }).error)).toBe(true);
  });
});

describe('el pedido sale igual que sin plazo', () => {
  it('la dirección y los headers, con SOAP 1.2, SOAP 1.1 y WSAA', async () => {
    await getLastNumber();
    await new ArcaFceObligationGateway(client()).getObligation(CLIENT_CUIT, '20261101');

    const [login, billing, , fce] = arca.server.requests;
    const common = {
      accept: 'text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
      'accept-charset': 'utf-8',
      'accept-encoding': 'none',
      connection: 'keep-alive',
      'user-agent': 'node-soap/1.13.1',
    };

    expect(login).toMatchObject({
      headers: { ...common, 'content-type': 'text/xml; charset=utf-8', soapaction: '""' },
      host: 'wsaahomo.afip.gov.ar',
      url: '/ws/services/LoginCms',
    });
    expect(billing).toMatchObject({
      headers: {
        ...common,
        'content-type':
          'application/soap+xml; charset=utf-8; action="http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado"',
      },
      host: 'wswhomo.afip.gov.ar',
      url: '/wsfev1/service.asmx',
    });
    expect(fce).toMatchObject({
      headers: {
        ...common,
        'content-type': 'text/xml; charset=utf-8',
        soapaction: '"http://ar.gob.afip.wsfecred/FECredService/consultarMontoObligadoRecepcion"',
      },
      host: 'fwshomo.afip.gov.ar',
      url: '/wsfecred/FECredService',
    });
    for (const request of arca.server.requests) {
      expect(Object.keys(request.headers).sort()).toEqual(
        expect.arrayContaining([...Object.keys(common), 'content-length', 'content-type', 'host'].sort()),
      );
    }
  });

  it('un certificado que no es de confianza se sigue rechazando', async () => {
    const { globalAgent } = await import('node:https');

    globalAgent.destroy();
    globalAgent.options.ca = undefined;

    expect(await arca.settle(fetchWsfeServerStatus('testing', never()))).toMatchObject({
      end: 'se cortó',
      error: { code: expect.stringMatching(/SELF_SIGNED_CERT/) as string },
    });
    expect(arca.server.requests).toEqual([]);
  });

  it('el proxy del entorno se sigue usando', async () => {
    process.env.https_proxy = 'http://proxy.invalid:3128';

    try {
      await expect(arca.settle(fetchWsfeServerStatus('testing', never()))).resolves.toMatchObject({ end: 'se cortó' });
      expect(arca.server.requests).toEqual([]);
      expect(arca.server.blocked).not.toEqual([]);
      expect(arca.server.blocked.every((target) => target.includes('proxy.invalid'))).toBe(true);
    } finally {
      delete process.env.https_proxy;
      arca.server.blocked.splice(0);
    }
  });
});

describe('un cliente con httpClient inyectado', () => {
  const ANSWER =
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><FEDummyResponse><FEDummyResult><AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer></FEDummyResult></FEDummyResponse></soap:Body></soap:Envelope>';

  function injected() {
    return {
      request: vi.fn((_url: string, _xml: string, done: (error: null, response: object, body: string) => void) => {
        done(null, { data: ANSWER, headers: {}, status: 200, statusCode: 200 }, ANSWER);

        return {};
      }),
    };
  }

  it('sigue andando, en los servicios y en los dummy, y no sale a la red', async () => {
    const soap = await createSoapArca('wsfe', () => ({
      body: '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><FECompUltimoAutorizadoResponse><FECompUltimoAutorizadoResult><CbteNro>41</CbteNro></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse></soap:Body></soap:Envelope>',
    }));

    expect((await soap.electronicBillingService.getLastVoucher(3, 11)).cbteNro).toBe(41);
    expect(await fetchWsfeServerStatus('testing', never(), injected() as never)).toEqual({
      app: 'OK',
      auth: 'OK',
      db: 'OK',
    });
    expect(arca.server.requests).toEqual([]);
  });

  it('recibe la señal del plazo, combinada con la de quien llama, y nada más', async () => {
    const http = injected();
    const controller = new AbortController();

    await fetchWsfeServerStatus('testing', controller.signal, http as never);

    const [, , , , options] = http.request.mock.calls[0] as unknown as [0, 0, 0, 0, Record<string, unknown>];

    expect(Object.keys(options)).toEqual(['signal']);
    controller.abort();
    expect((options.signal as AbortSignal).aborted).toBe(true);
  });

  // Tests primero (ARQ-11): pasa a it() al implementarlo.
  it.fails('con un httpClient inyectado, el plazo tampoco queda pendiente', async () => {
    await fetchWsfeServerStatus('testing', never(), injected() as never);
    expect(arca.deadlines).toEqual([{ ms: QUERY_MS, state: 'cancelado' }]);
  });
});
