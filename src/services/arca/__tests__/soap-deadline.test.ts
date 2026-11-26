import { MemoryTicketStorage, SoapClient } from '@arcasdk/core';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { isConnectionError } from '../../../lib/errors/connection-error';
import { ArcaDeadlineError } from '../../../lib/errors/deadline-error';
import { isTolerableTableError } from '../../../modules/export/export.tables';
import { useArcaDeadlines } from '../../../testing/arca-deadlines';
import { ArcaBillingGateway } from '../arca-billing.gateway';
import { ArcaClientFactory } from '../arca-client.factory';
import { ArcaFceObligationGateway } from '../arca-fce-obligation.gateway';
import { ArcaPadronGateway } from '../arca-padron.gateway';
import { ArcaVoucherHistoryGateway } from '../arca-voucher-history.gateway';
import { withCancellableQueries } from '../query-cancellation';
import { installSoapDeadlines, SOAP_OPERATIONS } from '../soap-deadline';
import { fetchWsfeServerStatus } from '../wsfe-status';
import { fetchWsfexServerStatus } from '../wsfex-status';

import { createSoapArca } from './arca-soap.fixture';

/**
 * ARQ-11: ninguna llamada a ARCA queda colgada sin límite. Corre todo de verdad (SDK, node-soap, axios y TLS) contra un
 * ARCA local que no contesta o que gotea; los plazos se acortan 100 veces (`src/testing/arca-server.ts`).
 */
vi.setConfig({ testTimeout: 30_000 });

const arca = useArcaDeadlines();

/** De sobra para una máquina cargada. */
const WAIT = { timeout: 10_000 };

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
  /** Se corta al abortar la señal de `withCancellableQueries`. La emisión y el login, nunca. */
  readonly cancellable: boolean;
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
    cancellable: true,
    ms: QUERY_MS,
    operation: 'FECompUltimoAutorizado',
    run: getLastNumber,
    service: 'electronicBillingService',
    withLogin: true,
  },
  {
    cancellable: false,
    ms: EMISSION_MS,
    operation: 'FECAESolicitar',
    run: () => new ArcaBillingGateway(client()).createVoucher(VOUCHER),
    service: 'electronicBillingService',
    withLogin: true,
  },
  {
    cancellable: true,
    ms: QUERY_MS,
    operation: 'FECompConsultar',
    run: () => new ArcaVoucherHistoryGateway(client()).getVoucher(1, 3, 11),
    service: 'genericService',
    withLogin: true,
  },
  {
    cancellable: true,
    ms: QUERY_MS,
    operation: 'FEXGetPARAM_DST_pais',
    run: () => exportGateway().getDestinationCountries(),
    service: 'wsfexService',
    withLogin: true,
  },
  {
    cancellable: true,
    ms: QUERY_MS,
    operation: 'FEXGetLast_CMP',
    run: () => exportGateway().getLastVoucherNumber(19, 3),
    service: 'wsfexService',
    withLogin: true,
  },
  {
    cancellable: false,
    ms: EMISSION_MS,
    operation: 'FEXAuthorize',
    run: () => exportGateway().authorize({ Cbte_nro: 8, Id: 42 } as never),
    service: 'wsfexService',
    withLogin: true,
  },
  {
    cancellable: true,
    ms: QUERY_MS,
    operation: 'consultarMontoObligadoRecepcion',
    run: () => new ArcaFceObligationGateway(client()).getObligation(CLIENT_CUIT, '20261101'),
    service: 'wsfecredService',
    withLogin: true,
  },
  {
    cancellable: true,
    ms: QUERY_MS,
    operation: 'getPersona_v2',
    run: () => new ArcaPadronGateway(client()).getTaxpayer(CLIENT_CUIT),
    service: 'registerInscriptionProofService',
    withLogin: true,
  },
  {
    cancellable: false,
    ms: WSAA_MS,
    next: QUERY_MS,
    operation: 'loginCms',
    run: getLastNumber,
    service: 'WSAA, desde el cliente',
  },
  {
    cancellable: false,
    ms: WSAA_MS,
    next: QUERY_MS,
    operation: 'loginCms',
    run: () => exportGateway().getLastVoucherNumber(19, 3),
    service: 'WSAA, desde AuthRepository',
  },
  {
    cancellable: true,
    ms: QUERY_MS,
    operation: 'FEDummy',
    run: () => fetchWsfeServerStatus('testing', never()),
    service: 'SoapClient',
  },
  {
    cancellable: true,
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

  it.each(['cuelga', 'gotea'] as const)('si ARCA %s, se corta en el plazo y no se reintenta', async (behavior) => {
    arca.server.respond((name) => (name === operation ? behavior : undefined));

    const settled = await arca.settle(run());

    expect(settled).toMatchObject({ end: 'se cortó' });

    const { message } = (settled as { error: Error }).error;

    expect(message).toContain(`no contestó en ${ms / 1000} segundos`);
    expect(message).not.toMatch(/no se emitió/i);
    expect(arca.server.count(operation)).toBe(1);
    // El pedido se cortó de verdad: no queda una conexión esperando.
    await vi.waitFor(() => expect(arca.server.requests.at(-1)?.dropped).toBe(true), WAIT);
  });

  it('el plazo de cada pedido, uno solo por pedido', async () => {
    await arca.settle(run());
    expect(arca.deadlines.map((deadline) => deadline.ms)).toEqual(plannedMs(call));
  });
});

describe('las operaciones que no están en la tabla', () => {
  it.each([
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

  it('crear más clientes no suma plazos: uno por pedido', async () => {
    client();
    exportGateway();
    await fetchWsfeServerStatus('testing', never());
    client();

    const before = arca.deadlines.length;

    await fetchWsfexServerStatus('testing', never());
    expect(arca.deadlines.slice(before).map(({ ms }) => ms)).toEqual([QUERY_MS]);
  });
});

describe('instalar dos veces no apila', () => {
  it.each([
    ['el mismo módulo', false],
    ['el módulo cargado otra vez', true],
  ])('%s: el método es el mismo y hay un solo plazo por pedido', async (_name, reload) => {
    installSoapDeadlines();

    const { createClient } = SoapClient.prototype as { createClient: unknown };

    if (reload) {
      vi.resetModules();
    }

    (await import('../soap-deadline')).installSoapDeadlines();
    expect((SoapClient.prototype as { createClient: unknown }).createClient).toBe(createClient);
    await fetchWsfeServerStatus('testing', never());
    expect(arca.deadlines).toEqual([{ ms: QUERY_MS, state: 'cancelado' }]);
  });
});

describe('el error de un plazo vencido', () => {
  async function expire(operation: string, run: () => Promise<unknown>): Promise<unknown> {
    arca.server.respond((name) => (name === operation ? 'cuelga' : undefined));

    const settled = await arca.settle(run());

    expect(settled).toMatchObject({ end: 'se cortó' });

    return (settled as { error: unknown }).error;
  }

  it('el texto de una consulta', async () => {
    expect(await expire('FECompUltimoAutorizado', getLastNumber)).toMatchObject({
      message: 'ARCA no contestó en 30 segundos.',
    });
  });

  it.each([
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

  it.each([
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

  it('dos logins vencidos no comparten estado: el segundo pedido vuelve a pedir el ticket', async () => {
    const gateway = exportGateway();

    await expire('loginCms', () => gateway.getUnits());
    arca.server.respond(() => undefined);
    expect(await arca.settle(gateway.getUnits())).toMatchObject({ end: 'contestó' });
    expect(arca.server.count('loginCms')).toBe(2);
  });

  it('el corte de otro no se confunde con el plazo', async () => {
    const controller = new AbortController();

    arca.server.respond(() => 'cuelga');

    arca.holdDeadlines();

    const call = arca.settle(fetchWsfeServerStatus('testing', controller.signal));

    await vi.waitFor(() => expect(arca.server.count('FEDummy')).toBe(1), WAIT);
    controller.abort();

    const settled = await call;

    expect(settled).toMatchObject({ end: 'se cortó', error: { code: 'ERR_CANCELED' } });
    expect((settled as { error: Error }).error.message).not.toContain('no contestó');
    expect(isConnectionError((settled as { error: Error }).error)).toBe(false);
    await vi.waitFor(() => expect(arca.server.requests.at(-1)?.dropped).toBe(true), WAIT);
  });

  it('cortado por otro, el plazo no queda pendiente', async () => {
    const controller = new AbortController();

    arca.server.respond(() => 'cuelga');

    arca.holdDeadlines();

    const call = arca.settle(fetchWsfexServerStatus('testing', controller.signal));

    await vi.waitFor(() => expect(arca.server.count('FEXDummy')).toBe(1), WAIT);
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

  it('no deja plazos pendientes: ni con respuesta ni con un error de red', async () => {
    await getLastNumber();
    expect(arca.deadlines).toEqual([
      { ms: WSAA_MS, state: 'cancelado' },
      { ms: QUERY_MS, state: 'cancelado' },
    ]);

    arca.server.respond((operation) => (operation === 'FECompUltimoAutorizado' ? 'cuelga' : undefined));

    arca.holdDeadlines();

    const call = arca.settle(getLastNumber());

    await vi.waitFor(() => expect(arca.server.count('FECompUltimoAutorizado')).toBe(2), WAIT);
    arca.server.drop();
    expect(await call).toMatchObject({ end: 'se cortó', error: { message: 'socket hang up' } });
    expect(arca.deadlines.slice(2).map(({ state }) => state)).toEqual(['cancelado', 'cancelado']);
  });

  it('la red caída da el error de siempre, y cuenta como de conexión', async () => {
    arca.server.respond(() => 'cuelga');

    arca.holdDeadlines();

    const call = arca.settle(fetchWsfeServerStatus('testing', never()));

    await vi.waitFor(() => expect(arca.server.count('FEDummy')).toBe(1), WAIT);
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

  it('con un httpClient inyectado, el plazo tampoco queda pendiente', async () => {
    await fetchWsfeServerStatus('testing', never(), injected() as never);
    expect(arca.deadlines).toEqual([{ ms: QUERY_MS, state: 'cancelado' }]);
  });
});

/**
 * ARQ-11 PR 6: dentro de `withCancellableQueries`, abortar la señal corta las consultas a ARCA y la conexión. La emisión
 * y el login nunca se cortan: ni con la señal del contexto ni con la que se pase al pedido.
 */
const CANCELLABLE = CALLS.filter(({ cancellable }) => cancellable);
const EMISSIONS = CALLS.filter(({ cancellable, next }) => !cancellable && next === undefined);
const LOGINS = CALLS.filter(({ cancellable, next }) => !cancellable && next !== undefined);

/** Un pedido que tarda esto en contestarse sigue en curso cuando se corta la señal; no es un ARCA colgado. */
const SLOW_MS = 500;

const aborted = (reason?: unknown): AbortSignal => {
  const controller = new AbortController();

  controller.abort(reason);

  return controller.signal;
};

const requestsOf = (operation: string) => arca.server.requests.filter((request) => request.operation === operation);

/** Los pedidos de `operation`, ya terminados: antes, `dropped` todavía no dice si se cortaron. */
async function finishedRequests(operation: string) {
  await vi.waitFor(() => expect(requestsOf(operation).every(({ closed }) => closed)).toBe(true), WAIT);

  return requestsOf(operation);
}

/** Corre `run` en un contexto y aborta la señal cuando ARCA ya recibió `operation` y no la contesta. */
async function abortWhileHung(operation: string, run: () => Promise<unknown>, reason?: unknown) {
  const controller = new AbortController();

  arca.server.respond((name) => (name === operation ? 'cuelga' : undefined));
  arca.holdDeadlines();

  const call = arca.settle(withCancellableQueries(controller.signal, run));

  await vi.waitFor(() => expect(arca.server.count(operation)).toBe(1), WAIT);
  controller.abort(reason);
  // Lo que no se cortó con la señal termina por el plazo, con otro error.
  arca.releaseDeadlines();

  return { reason: controller.signal.reason as unknown, settled: await call };
}

describe.each(CANCELLABLE)('cancelable, $service: $operation', ({ operation, run }) => {
  it('cortada la señal mientras ARCA no contesta: corta enseguida, con su razón, y cierra la conexión', async () => {
    const reason = new Error('Lo cortó quien llama.');
    const { settled } = await abortWhileHung(operation, run, reason);

    expect(settled).toMatchObject({ end: 'se cortó' });
    expect((settled as { error: unknown }).error).toBe(reason);
    // Cortó la señal y no el plazo: ninguno vence ni queda corriendo.
    expect(arca.deadlines.filter(({ state }) => state !== 'cancelado')).toEqual([]);
    await vi.waitFor(() => expect(requestsOf(operation)[0]?.dropped).toBe(true), WAIT);
  });

  it('con la señal ya cortada, no le pide nada a ARCA', async () => {
    const reason = new Error('Lo cortó quien llama.');
    const settled = await arca.settle(withCancellableQueries(aborted(reason), run));

    expect(settled).toMatchObject({ end: 'se cortó' });
    expect((settled as { error: unknown }).error).toBe(reason);
    expect(arca.server.count(operation)).toBe(0);
  });
});

describe('cancelable, lo que no está en la tabla', () => {
  it.each([
    'FEParamGetTiposPaises',
    // Parecida a la que emite, pero no es.
    'FECAEASolicitar',
  ])('%s: con la señal ya cortada, no se pide', async (operation) => {
    const settled = await arca.settle(
      withCancellableQueries(aborted(), async () => client().genericService.call('wsfe', operation, {})),
    );

    expect(settled).toMatchObject({ end: 'se cortó' });
    expect(arca.server.count(operation)).toBe(0);
  });
});

describe('la razón de una cancelación', () => {
  it.each([
    ['una consulta', 'FECompUltimoAutorizado', getLastNumber],
    ['una tabla de la E', 'FEXGetPARAM_DST_pais', () => exportGateway().getDestinationCountries()],
    ['el estado del servidor', 'FEDummy', () => fetchWsfeServerStatus('testing', never())],
  ] as const)('%s: es la de la señal, no un error de conexión ni un plazo vencido', async (_name, operation, run) => {
    const { reason, settled } = await abortWhileHung(operation, run);
    const { error } = settled as { error: unknown };

    expect(error).toBe(reason);
    expect(error).not.toBeInstanceOf(ArcaDeadlineError);
    expect(isConnectionError(error)).toBe(false);
    // Una tabla de la E cortada no se toma como una que falló y se puede saltear.
    expect(isTolerableTableError(error)).toBe(false);
  });
});

describe.each(EMISSIONS)('no cancelable, $service: $operation', (call) => {
  const { operation, run } = call;

  it('dentro del contexto, con la señal ya cortada, se emite igual, con su plazo', async () => {
    expect(await arca.settle(withCancellableQueries(aborted(), run))).toMatchObject({ end: 'contestó' });
    expect(await finishedRequests(operation)).toEqual([expect.objectContaining({ dropped: false })]);
    expect(arca.deadlines.map(({ ms }) => ms)).toEqual(plannedMs(call));
  });

  it('dentro del contexto, cortada la señal durante el pedido, se espera la respuesta', async () => {
    const controller = new AbortController();

    arca.server.respond((name) => (name === operation ? SLOW_MS : undefined));

    const settled = arca.settle(withCancellableQueries(controller.signal, run));

    await vi.waitFor(() => expect(arca.server.count(operation)).toBe(1), WAIT);
    controller.abort();
    expect(await settled).toMatchObject({ end: 'contestó' });
    expect(await finishedRequests(operation)).toEqual([expect.objectContaining({ dropped: false })]);
  });
});

describe.each(LOGINS)('no cancelable, $service: $operation', ({ run }) => {
  it('dentro del contexto, con la señal ya cortada, el ticket se pide igual', async () => {
    await arca.settle(withCancellableQueries(aborted(), run));
    expect(await finishedRequests('loginCms')).toEqual([expect.objectContaining({ dropped: false })]);
  });

  it('dentro del contexto, cortada la señal durante el login, se espera el ticket', async () => {
    const controller = new AbortController();

    arca.server.respond((name) => (name === 'loginCms' ? SLOW_MS : undefined));

    const settled = arca.settle(withCancellableQueries(controller.signal, run));

    await vi.waitFor(() => expect(arca.server.count('loginCms')).toBe(1), WAIT);
    controller.abort();
    await settled;
    expect(await finishedRequests('loginCms')).toEqual([expect.objectContaining({ dropped: false })]);
  });
});

/** Los WSDL del SDK en testing: un pedido directo, sin los servicios del SDK, para pasarle `options.signal`. */
const WSDLS = { FECAESolicitar: 'wsfe.wsdl', FEXAuthorize: 'wsfex.wsdl', loginCms: 'wsaa.wsdl' } as const;

type SoapMethod = (args: object, options: { readonly signal: AbortSignal }) => Promise<unknown>;

async function callWithSignal(operation: keyof typeof WSDLS, signal: AbortSignal): Promise<unknown> {
  installSoapDeadlines();

  const soap = (await new SoapClient().createClient(WSDLS[operation], {
    forceSoap12Headers: operation !== 'loginCms',
  })) as unknown as Record<string, SoapMethod>;

  return soap[`${operation}Async`]({}, { signal });
}

describe.each(Object.keys(WSDLS) as Array<keyof typeof WSDLS>)('%s con `options.signal`', (operation) => {
  it('ya cortada, se pide igual', async () => {
    expect(await arca.settle(callWithSignal(operation, aborted()))).toMatchObject({ end: 'contestó' });
    expect(await finishedRequests(operation)).toEqual([expect.objectContaining({ dropped: false })]);
  });

  it('cortada durante el pedido, se espera la respuesta', async () => {
    const controller = new AbortController();

    arca.server.respond((name) => (name === operation ? SLOW_MS : undefined));

    const settled = arca.settle(callWithSignal(operation, controller.signal));

    await vi.waitFor(() => expect(arca.server.count(operation)).toBe(1), WAIT);
    controller.abort();
    expect(await settled).toMatchObject({ end: 'contestó' });
    expect(await finishedRequests(operation)).toEqual([expect.objectContaining({ dropped: false })]);
  });
});

describe('contextos', () => {
  it('dos a la vez no se mezclan: cortar uno no corta la consulta del otro', async () => {
    const first = new AbortController();
    const second = new AbortController();

    arca.server.respond((name) => (name === 'FECompUltimoAutorizado' ? SLOW_MS : undefined));

    const cut = arca.settle(withCancellableQueries(first.signal, getLastNumber));
    const kept = arca.settle(withCancellableQueries(second.signal, getLastNumber));

    await vi.waitFor(() => expect(arca.server.count('FECompUltimoAutorizado')).toBe(2), WAIT);
    first.abort();

    const settled = await cut;

    expect(settled).toMatchObject({ end: 'se cortó' });
    expect((settled as { error: unknown }).error).toBe(first.signal.reason);
    expect(await kept).toEqual({ end: 'contestó', value: 41 });
    await vi.waitFor(
      () => expect(requestsOf('FECompUltimoAutorizado').map(({ dropped }) => dropped)).toContain(true),
      WAIT,
    );
    expect(requestsOf('FECompUltimoAutorizado').filter(({ dropped }) => !dropped)).toHaveLength(1);
  });

  it('uno adentro de otro: cortar el de afuera también corta las consultas del de adentro', async () => {
    const outer = new AbortController();
    const reason = new Error('Lo cortó el de afuera.');

    arca.server.respond((name) => (name === 'FECompUltimoAutorizado' ? 'cuelga' : undefined));
    arca.holdDeadlines();

    const call = arca.settle(
      withCancellableQueries(outer.signal, async () =>
        withCancellableQueries(new AbortController().signal, getLastNumber),
      ),
    );

    await vi.waitFor(() => expect(arca.server.count('FECompUltimoAutorizado')).toBe(1), WAIT);
    outer.abort(reason);
    arca.releaseDeadlines();
    expect(await call).toEqual({ end: 'se cortó', error: reason });
  });

  it('terminado el contexto, cortar su señal no corta lo que se pide después', async () => {
    const controller = new AbortController();

    await withCancellableQueries(controller.signal, async () => undefined);
    controller.abort();
    expect(await arca.settle(getLastNumber())).toEqual({ end: 'contestó', value: 41 });
  });
});

describe('contrato de la cancelación', () => {
  it('la emisión y el login no se cancelan, por tipo', () => {
    expectTypeOf(SOAP_OPERATIONS.FECAESolicitar.cancellable).toEqualTypeOf<false>();
    expectTypeOf(SOAP_OPERATIONS.FEXAuthorize.cancellable).toEqualTypeOf<false>();
    expectTypeOf(SOAP_OPERATIONS.loginCms.cancellable).toEqualTypeOf<false>();
  });

  it('cada operación de la tabla tiene su caso arriba, cancelable o no, como dice la tabla', () => {
    const table: Readonly<Record<string, { readonly cancellable: boolean; readonly ms: number }>> = SOAP_OPERATIONS;

    expect(table, 'soap-deadline.ts exporta la tabla de operaciones').toBeDefined();

    const inTable = (operation: string) => Object.hasOwn(table, operation);
    const fromTable = Object.fromEntries(
      Object.entries(table).map(([operation, { cancellable, ms }]) => [operation, { cancellable, ms }]),
    );
    const fromCases = Object.fromEntries(
      CALLS.filter(({ operation }) => inTable(operation)).map(({ cancellable, ms, operation }) => [
        operation,
        { cancellable, ms },
      ]),
    );

    expect(fromCases).toEqual(fromTable);
    expect(Object.values(fromTable).filter(({ cancellable }) => !cancellable)).toHaveLength(3);
    // Lo que no está en la tabla es una consulta: 30 segundos y cancelable.
    expect(
      CALLS.filter(({ operation }) => !inTable(operation)).filter(
        ({ cancellable, ms }) => !cancellable || ms !== QUERY_MS,
      ),
    ).toEqual([]);
  });
});
