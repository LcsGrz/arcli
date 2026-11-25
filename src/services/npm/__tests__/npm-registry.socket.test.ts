import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer, globalAgent, type Server as HttpsServer } from 'node:https';
import { type AddressInfo, connect, createServer, type Server, type Socket } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSelfSignedCertificate,
  OPENSSL_WARM_UP_TIMEOUT_MS,
  removeSelfSignedCertificates,
} from '../../../lib/security/__tests__/self-signed-certificate';
import { requestNpmRegistry } from '../npm-registry';

/** Con conexiones de verdad, a servidores locales: al cancelar, el socket se cierra en cualquier momento. */

let registry: HttpsServer;
let proxy: Server;
/** Las conexiones que recibio cada servidor y siguen abiertas. */
const open = new Set<Socket>();
const connects: string[] = [];
/** Lo que hace el registry con un pedido. */
let answer: 'completo' | 'mitad' = 'completo';
/** Lo que hace el proxy con un CONNECT. */
let tunnel: 'callado' | 'colgado' | 'completo' = 'completo';

const agentOptions = globalAgent.options as Record<string, unknown>;
const original = { ...agentOptions };
const portOf = (server: Server | HttpsServer) => (server.address() as AddressInfo).port;
const url = () => `https://localhost:${portOf(registry)}/arcli/latest`;

function track(socket: Socket): void {
  open.add(socket.on('error', () => undefined).on('close', () => open.delete(socket)));
}

function throughProxy(): void {
  agentOptions.proxyEnv = { HTTPS_PROXY: `http://127.0.0.1:${portOf(proxy)}` };
}

beforeAll(() => {
  createSelfSignedCertificate(365);
}, OPENSSL_WARM_UP_TIMEOUT_MS);

afterAll(removeSelfSignedCertificates);

beforeEach(async () => {
  const { certPath, keyPath } = createSelfSignedCertificate(365);

  registry = createHttpsServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, (_request, response) => {
    if (answer === 'mitad') {
      response.writeHead(200, { 'content-length': '1000' }).write('{"version":');
    } else {
      response.end('{"version":"9.0.0"}');
    }
  });
  registry.on('connection', track);
  proxy = createServer((socket) => {
    track(socket);
    socket.once('data', (data) => {
      connects.push(String(data).split('\r\n')[0] ?? '');

      if (tunnel === 'callado') return;

      socket.write('HTTP/1.1 200 OK\r\n\r\n');

      if (tunnel === 'completo') {
        const target = connect(portOf(registry), 'localhost');

        target.on('error', () => socket.destroy());
        socket.pipe(target).pipe(socket);
      }
    });
  });
  await new Promise<void>((resolve) => registry.listen(0, 'localhost', resolve));
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  // El certificado es ficticio y de otro nombre.
  Object.assign(agentOptions, { ca: readFileSync(certPath), servername: 'arcli-test' });
  delete agentOptions.proxyEnv;
  connects.length = 0;
});

afterEach(() => {
  for (const key of Object.keys(agentOptions)) delete agentOptions[key];
  Object.assign(agentOptions, original);
  open.forEach((socket) => socket.destroy());
  registry.close();
  proxy.close();
});

describe('requestNpmRegistry con conexiones de verdad', () => {
  it('lee la respuesta y no deja la conexión abierta', async () => {
    answer = 'completo';

    const response = await requestNpmRegistry(url(), { signal: new AbortController().signal });

    expect(await response.json()).toEqual({ version: '9.0.0' });
    await vi.waitFor(() => expect(open.size).toBe(0));
  });

  it('cancelada con los encabezados y medio cuerpo, rechaza y cierra la conexión', async () => {
    const controller = new AbortController();

    answer = 'mitad';

    let result = 'pendiente';
    const request = requestNpmRegistry(url(), { signal: controller.signal }).then(
      () => (result = 'contestó'),
      () => (result = 'rechazó'),
    );
    const received = new Promise<void>((resolve) => {
      registry.once('request', () => setTimeout(resolve, 50));
    });

    await received;
    expect([result, open.size]).toEqual(['pendiente', 1]);
    controller.abort();
    await request;
    expect(result).toBe('rechazó');
    await vi.waitFor(() => expect(open.size).toBe(0));
  });

  it('ya cancelada, no conecta', async () => {
    await expect(requestNpmRegistry(url(), { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(open.size).toBe(0);
  });

  it('rechaza un certificado que no es de confianza', async () => {
    delete agentOptions.ca;

    await expect(requestNpmRegistry(url(), { signal: new AbortController().signal })).rejects.toMatchObject({
      code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    });
  });

  it('usa el proxy del agente global, el de `NODE_USE_ENV_PROXY`', async () => {
    answer = 'completo';
    tunnel = 'completo';
    throughProxy();

    const response = await requestNpmRegistry(url(), { signal: new AbortController().signal });

    expect(await response.json()).toEqual({ version: '9.0.0' });
    expect(connects).toEqual([`CONNECT localhost:${portOf(registry)} HTTP/1.1`]);
  });

  it.each(['callado', 'colgado'] as const)('cancelada con el proxy %s, rechaza y corta el túnel', async (state) => {
    const controller = new AbortController();

    tunnel = state;
    throughProxy();

    const request = requestNpmRegistry(url(), { signal: controller.signal });
    const rejected = expect(request).rejects.toThrow();

    await vi.waitFor(() => expect(connects).toHaveLength(1));
    expect(open.size).toBe(1);
    controller.abort();
    await rejected;
    await vi.waitFor(() => expect(open.size).toBe(0));
  });
});
