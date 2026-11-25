import { generateKeyPairSync } from 'node:crypto';
import dns from 'node:dns';
import type { IncomingMessage, ServerResponse } from 'node:http';
import https from 'node:https';
import net, { type AddressInfo, type Socket } from 'node:net';
import forge from 'node-forge';

/**
 * Un ARCA local por HTTPS, con las direcciones reales del SDK: lo que va a un servidor de ARCA se conecta a 127.0.0.1 y
 * cualquier otra conexion o consulta de DNS falla y queda en `blocked`. Arriba corre todo de verdad (SDK, node-soap,
 * axios, TLS). El certificado y la clave son ficticios y se generan aca.
 */
export const ARCA_HOSTS: readonly string[] = [
  'aws.afip.gov.ar',
  'awshomo.afip.gov.ar',
  'fwshomo.afip.gov.ar',
  'servicios1.afip.gov.ar',
  'serviciosjava.afip.gob.ar',
  'wsaa.afip.gov.ar',
  'wsaahomo.afip.gov.ar',
  'wswhomo.afip.gov.ar',
];

/** Con un proxy en el entorno de quien corre los tests, axios iria por ahi. */
export const PROXY_VARIABLES: readonly string[] = ['http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'].flatMap(
  (name) => [name, name.toUpperCase()],
);

const DAY_MS = 24 * 60 * 60 * 1000;

/** `cuelga`: no contesta. `gotea`: manda un espacio cada tanto, sin terminar. Un numero: contesta a los tantos ms. */
export type ArcaBehavior = 'cuelga' | 'gotea' | number;

interface ArcaRequest {
  readonly body: string;
  /** El cliente corto antes de que se terminara de contestarle. */
  dropped: boolean;
  /** Es uno de los que no se contestan. */
  readonly hangs: boolean;
  readonly headers: IncomingMessage['headers'];
  readonly host: string;
  readonly operation: string;
  readonly url: string;
}

export interface ArcaServer {
  /** Intentos de salir a otro lado. Tiene que quedar vacio. */
  readonly blocked: string[];
  /** PEM autofirmado con los nombres de ARCA: sirve de certificado del servidor y del emisor. */
  readonly cert: string;
  readonly key: string;
  readonly port: number;
  readonly requests: readonly ArcaRequest[];
  /** Cuantas veces se recibio cada operacion. */
  count(operation: string): number;
  /** Corta lo que este colgado. */
  drop(): void;
  /** Como responde un pedido; sin definir, contesta bien. `call` es cuantas veces llego esa operacion, desde 1. */
  respond(behavior: (operation: string, call: number) => ArcaBehavior | undefined): void;
  stop(): Promise<void>;
}

function createCertificate(): { readonly cert: string; readonly key: string } {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });
  const cert = forge.pki.createCertificate();
  const name = [{ name: 'commonName', value: 'arcli-test' }];

  cert.publicKey = forge.pki.publicKeyFromPem(pair.publicKey);
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - DAY_MS);
  cert.validity.notAfter = new Date(Date.now() + 365 * DAY_MS);
  cert.setSubject(name);
  cert.setIssuer(name);
  cert.setExtensions([{ altNames: ARCA_HOSTS.map((value) => ({ type: 2, value })), name: 'subjectAltName' }]);
  cert.sign(forge.pki.privateKeyFromPem(pair.privateKey) as forge.pki.rsa.PrivateKey, forge.md.sha256.create());

  return { cert: forge.pki.certificateToPem(cert), key: pair.privateKey };
}

const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** El ticket que da WSAA: un XML adentro de otro. */
function loginAnswer(): string {
  const ticket = `<loginTicketResponse version="1.0"><header><source>wsaa</source><destination>arcli-test</destination><uniqueId>1</uniqueId><generationTime>2026-01-01T00:00:00.000-03:00</generationTime><expirationTime>${new Date(Date.now() + DAY_MS).toISOString()}</expirationTime></header><credentials><token>token</token><sign>firma</sign></credentials></loginTicketResponse>`;

  return `<loginCmsReturn>${escapeXml(ticket)}</loginCmsReturn>`;
}

const FEX_OK = '<FEXErr><ErrCode>0</ErrCode><ErrMsg>OK</ErrMsg></FEXErr>';

const FEX_TABLES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    FEXCheck_Permiso: '<Status>OK</Status>',
    FEXGetLast_ID: '<Id>41</Id>',
    FEXGetPARAM_Actividades:
      '<ClsFEXResponse_ActividadTipo><Id>620100</Id><Desc>CONSULTORES</Desc></ClsFEXResponse_ActividadTipo>',
    FEXGetPARAM_DST_CUIT:
      '<ClsFEXResponse_DST_cuit><DST_CUIT>55000002126</DST_CUIT><DST_Ds>ESTADOS UNIDOS - Persona Juridica</DST_Ds></ClsFEXResponse_DST_cuit>',
    FEXGetPARAM_DST_pais:
      '<ClsFEXResponse_DST_pais><DST_Codigo>212</DST_Codigo><DST_Ds>ESTADOS UNIDOS</DST_Ds></ClsFEXResponse_DST_pais>',
    FEXGetPARAM_Idiomas: '<ClsFEXResponse_Idi><Idi_Id>1</Idi_Id><Idi_Ds>Espanol</Idi_Ds></ClsFEXResponse_Idi>',
    FEXGetPARAM_Incoterms:
      '<ClsFEXResponse_Inc><Inc_Id>FOB</Inc_Id><Inc_Ds>Free on Board</Inc_Ds></ClsFEXResponse_Inc>',
    FEXGetPARAM_MON: '<ClsFEXResponse_Mon><Mon_Id>DOL</Mon_Id><Mon_Ds>Dolar</Mon_Ds></ClsFEXResponse_Mon>',
    FEXGetPARAM_UMed: '<ClsFEXResponse_UMed><Umed_Id>7</Umed_Id><Umed_Ds>unidades</Umed_Ds></ClsFEXResponse_UMed>',
  }),
);

const readTag = (xml: string, tag: string): string => new RegExp(`<(?:\\w+:)?${tag}>([^<]*)<`).exec(xml)?.[1] ?? '';

const servers = (operation: string): string =>
  `<${operation}Result><AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer></${operation}Result>`;

/** Lo que contesta cada operacion que no es una tabla de la E. El ultimo numero es el 41, y en la E el 7. */
const ANSWERS = new Map<string, (xml: string, emitted: number) => string>(
  Object.entries({
    FECAESolicitar: (xml: string) => {
      const number = readTag(xml, 'CbteDesde');

      return `<FECAESolicitarResult><FeCabResp><Resultado>A</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><CbteDesde>${number}</CbteDesde><CbteHasta>${number}</CbteHasta><Resultado>A</Resultado><CAE>75123456789012</CAE><CAEFchVto>20991231</CAEFchVto></FECAEDetResponse></FeDetResp></FECAESolicitarResult>`;
    },
    FECompConsultar: () =>
      '<FECompConsultarResult><Errors><Err><Code>602</Code><Msg>Sin Resultados</Msg></Err></Errors></FECompConsultarResult>',
    FECompUltimoAutorizado: (_xml: string, emitted: number) =>
      `<FECompUltimoAutorizadoResult><PtoVta>3</PtoVta><CbteTipo>11</CbteTipo><CbteNro>${41 + emitted}</CbteNro></FECompUltimoAutorizadoResult>`,
    FEDummy: () => servers('FEDummy'),
    FEParamGetCotizacion: () =>
      '<FEParamGetCotizacionResult><ResultGet><MonId>DOL</MonId><MonCotiz>1450</MonCotiz><FchCotiz>20261109</FchCotiz></ResultGet></FEParamGetCotizacionResult>',
    FEParamGetPtosVenta: () =>
      '<FEParamGetPtosVentaResult><Errors><Err><Code>602</Code><Msg>Sin Resultados</Msg></Err></Errors></FEParamGetPtosVentaResult>',
    FEXAuthorize: (xml: string) =>
      `<FEXAuthorizeResult><FEXResultAuth><Id>${readTag(xml, 'Id')}</Id><Cbte_tipo>19</Cbte_tipo><Punto_vta>3</Punto_vta><Cbte_nro>${readTag(xml, 'Cbte_nro')}</Cbte_nro><Cae>75123456789012</Cae><Fch_venc_Cae>20991231</Fch_venc_Cae><Resultado>A</Resultado></FEXResultAuth>${FEX_OK}</FEXAuthorizeResult>`,
    FEXDummy: () => servers('FEXDummy'),
    FEXGetLast_CMP: () =>
      `<FEXGetLast_CMPResult><FEXResult_LastCMP><Cbte_nro>7</Cbte_nro></FEXResult_LastCMP>${FEX_OK}</FEXGetLast_CMPResult>`,
    consultarMontoObligadoRecepcion: () =>
      '<consultarMontoObligadoRecepcionReturn><obligado>N</obligado><montoDesde>3958316</montoDesde></consultarMontoObligadoRecepcionReturn>',
    getPersona_v2: () =>
      '<personaReturn><datosGenerales><estadoClave>ACTIVO</estadoClave><razonSocial>PRUEBA SA</razonSocial></datosGenerales></personaReturn>',
    loginCms: loginAnswer,
  }),
);

function successAnswer(operation: string, xml: string, emitted: number): string {
  const table = FEX_TABLES.get(operation);
  const answer = ANSWERS.get(operation);

  if (table !== undefined) {
    return `<${operation}Result><FEXResultGet>${table}</FEXResultGet>${FEX_OK}</${operation}Result>`;
  }

  return answer === undefined ? `<${operation}Result></${operation}Result>` : answer(xml, emitted);
}

function envelope(operation: string, xml: string, emitted: number): string {
  return `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${operation}Response>${successAnswer(operation, xml, emitted)}</${operation}Response></soap:Body></soap:Envelope>`;
}

interface ConnectOptions {
  readonly host?: string;
  readonly path?: string;
  readonly port?: number;
}

/** Lo que va a ARCA, al servidor local; el resto falla. Devuelve como volver atras. */
function redirectNetwork(port: number, cert: string, blocked: string[]): () => void {
  const { connect } = net.Socket.prototype;
  const { lookup } = dns;
  const { ca } = https.globalAgent.options;
  const proxies = PROXY_VARIABLES.map((name) => [name, process.env[name]] as const);

  // Las opciones llegan sueltas o ya normalizadas en una lista.
  net.Socket.prototype.connect = function redirected(this: Socket, ...args: readonly unknown[]) {
    const flat = args.flat();
    const options = flat.find((arg) => typeof arg === 'object' && arg !== null) as ConnectOptions | undefined;
    const done = flat.find((arg) => typeof arg === 'function') as (() => void) | undefined;

    if (ARCA_HOSTS.includes(options?.host ?? '')) {
      return Reflect.apply(connect, this, [{ host: '127.0.0.1', port }, done]) as Socket;
    }

    const target = `${options?.host ?? options?.path ?? '?'}:${options?.port ?? ''}`;

    blocked.push(target);

    throw new Error(`Este test no puede usar la red: ${target}`);
  } as typeof connect;
  dns.lookup = ((host: string) => {
    blocked.push(`dns ${host}`);

    throw new Error(`Este test no puede usar la red: dns ${host}`);
  }) as unknown as typeof lookup;
  https.globalAgent.options.ca = cert;
  PROXY_VARIABLES.forEach((name) => delete process.env[name]);

  return () => {
    net.Socket.prototype.connect = connect;
    dns.lookup = lookup;
    https.globalAgent.options.ca = ca;
    https.globalAgent.destroy();
    for (const [name, value] of proxies) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  };
}

/** Levanta el servidor. Con `redirect`, ademas manda ahi lo que este proceso le pida a ARCA. */
export async function startArcaServer({ redirect }: { readonly redirect: boolean }): Promise<ArcaServer> {
  const { cert, key } = createCertificate();
  const blocked: string[] = [];
  const requests: ArcaRequest[] = [];
  const sockets = new Set<Socket>();
  const timers = new Set<NodeJS.Timeout>();
  // Los de verdad, aunque el test acorte los plazos: ver `trackDeadlines`.
  const { clearTimeout: stopTimer, setTimeout: startTimer } = globalThis;
  let behave: (operation: string, call: number) => ArcaBehavior | undefined = () => undefined;

  const count = (operation: string): number => requests.filter((request) => request.operation === operation).length;

  function answer(request: IncomingMessage, response: ServerResponse, body: string): void {
    // En wsfecred, el elemento se llama como la operacion mas `Request`.
    const operation = /<(?:\w+:)?Body[^>]*>\s*<(?:\w+:)?(\w+?)(?:Request)?[\s/>]/.exec(body)?.[1] ?? '?';
    const emitted = count('FECAESolicitar');
    const behavior = behave(operation, count(operation) + 1);
    const entry: ArcaRequest = {
      body,
      dropped: false,
      hangs: behavior === 'cuelga' || behavior === 'gotea',
      headers: request.headers,
      host: request.headers.host ?? '',
      operation,
      url: request.url ?? '',
    };

    requests.push(entry);
    response.on('close', () => {
      entry.dropped = !response.writableFinished;
    });

    const send = (): void => {
      response.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      response.end(envelope(operation, body, emitted));
    };
    const drip = (): void => {
      if (!response.destroyed) {
        response.write(' ');
        timers.add(startTimer(drip, 20));
      }
    };

    if (behavior === undefined) {
      send();
    } else if (behavior === 'gotea') {
      response.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      drip();
    } else if (behavior !== 'cuelga') {
      timers.add(startTimer(send, behavior));
    }
  }

  const server = https.createServer({ cert, key }, (request, response) => {
    const chunks: Buffer[] = [];

    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => answer(request, response, Buffer.concat(chunks).toString('utf8')));
  });

  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address() as AddressInfo;
  const restoreNetwork = redirect ? redirectNetwork(port, cert, blocked) : () => undefined;
  const drop = (): void => sockets.forEach((socket) => socket.destroy());

  return {
    blocked,
    cert,
    count,
    drop,
    key,
    port,
    requests,
    respond: (behavior) => {
      behave = behavior;
    },
    stop: async () => {
      timers.forEach((timer) => stopTimer(timer));

      const closed = new Promise((resolve) => {
        server.close(resolve);
      });

      drop();
      await closed;
      restoreNetwork();
    },
  };
}

/** Los plazos de ARQ-11, en milisegundos, y por cuanto se dividen en los tests. */
export const DEADLINES_MS: readonly number[] = [30_000, 60_000, 120_000];
const DEADLINE_SCALE = 100;
const RECHECK_MS = 10;

export interface TrackedDeadline {
  readonly ms: number;
  state: 'cancelado' | 'pendiente' | 'vencido';
}

/**
 * Anota cada plazo de 30, 60 o 120 s que se pone con `setTimeout` o `AbortSignal.timeout` y lo acorta, sin tocar los
 * demas. Es el unico supuesto sobre como se implementan: los globales, no los de `node:timers`.
 *
 * Acortado, vence solo si `canExpire` da `true`; si no, espera. Asi una maquina cargada no vence un pedido que ARCA
 * iba a contestar.
 */
export function trackDeadlines(canExpire: (deadlines: readonly TrackedDeadline[]) => boolean): {
  readonly deadlines: readonly TrackedDeadline[];
  readonly restore: () => void;
} {
  const { clearTimeout, setTimeout } = globalThis;
  const { timeout } = AbortSignal;
  const deadlines: TrackedDeadline[] = [];
  const byTimer = new Map<unknown, TrackedDeadline>();

  function start(run: (...args: unknown[]) => void, ms?: number, ...args: unknown[]): NodeJS.Timeout {
    if (ms === undefined || !DEADLINES_MS.includes(ms)) {
      return setTimeout(run, ms, ...args);
    }

    const deadline: TrackedDeadline = { ms, state: 'pendiente' };
    const expire = (): void => {
      if (deadline.state !== 'pendiente') {
        return;
      }

      if (canExpire(deadlines)) {
        deadline.state = 'vencido';
        run(...args);
      } else {
        setTimeout(expire, RECHECK_MS);
      }
    };
    const timer = setTimeout(expire, ms / DEADLINE_SCALE);

    deadlines.push(deadline);
    byTimer.set(timer, deadline);

    return timer;
  }

  globalThis.setTimeout = Object.assign(start, setTimeout) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (timer) => {
    const deadline = byTimer.get(timer);

    if (deadline?.state === 'pendiente') {
      deadline.state = 'cancelado';
    }

    clearTimeout(timer);
  };
  AbortSignal.timeout = (ms) => {
    if (!DEADLINES_MS.includes(ms)) {
      return timeout.call(AbortSignal, ms);
    }

    const controller = new AbortController();

    start(() => controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')), ms);

    return controller.signal;
  };

  return {
    deadlines,
    restore: () => {
      globalThis.clearTimeout = clearTimeout;
      globalThis.setTimeout = setTimeout;
      AbortSignal.timeout = timeout;
    },
  };
}
