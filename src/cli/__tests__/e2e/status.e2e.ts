import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { type AddressInfo, createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createSelfSignedCertificate,
  OPENSSL_WARM_UP_TIMEOUT_MS,
  removeSelfSignedCertificates,
} from '../../../lib/security/__tests__/self-signed-certificate';

/**
 * `estado` con WSFEX que acepta la conexion y no contesta: el proceso tiene que terminar solo. Sin red externa: un
 * preload manda cualquier conexion a un servidor local que se queda callado y reemplaza lo de WSFE.
 */
const CLI = resolve('dist/cli/index.js');
/** 5 s del sondeo y lo que tarde el equipo en arrancar. */
const MAX_WAIT_MS = 15_000;

let directory = '';
let server: Server;
const sockets = new Set<Socket>();

function preload(serverStatus: string): string {
  const path = join(directory, 'estado.mjs');
  const gateway = pathToFileURL(resolve('dist/services/arca/arca-parameters.gateway.js')).href;

  writeFileSync(
    path,
    `import dns from 'node:dns';
     import { syncBuiltinESMExports } from 'node:module';
     import net from 'node:net';
     import { ArcaParametersGateway } from ${JSON.stringify(gateway)};
     const { connect } = net.Socket.prototype;
     net.Socket.prototype.connect = function () {
       return connect.call(this, { host: '127.0.0.1', port: ${(server.address() as AddressInfo).port} });
     };
     dns.lookup = (_host, options, done) =>
       (done ?? options)(null, options.all ? [{ address: '127.0.0.1', family: 4 }] : '127.0.0.1', 4);
     syncBuiltinESMExports();
     ArcaParametersGateway.prototype.getServerStatus = async () => { ${serverStatus} };
     ArcaParametersGateway.prototype.getSalesPoints = async () => [];`,
  );

  return pathToFileURL(path).href;
}

async function runStatus(serverStatus: string) {
  const start = Date.now();
  const child = spawn(process.execPath, ['--import', preload(serverStatus), CLI, 'estado', '--json'], {
    env: {
      ...process.env,
      ARCLI_CONFIG_DIR: directory,
      HOME: directory,
      NO_UPDATE_NOTIFIER: '1',
      USERPROFILE: directory,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  const read = { stderr: '', stdout: '' };

  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (read.stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (read.stderr += chunk));

  const [code] = (await once(child, 'close')) as [number | null];

  return { ...read, code, elapsed: Date.now() - start };
}

beforeAll(() => {
  createSelfSignedCertificate(365);
}, OPENSSL_WARM_UP_TIMEOUT_MS);

afterAll(removeSelfSignedCertificates);

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'arcli-estado-'));
  server = createServer((socket) => {
    sockets.add(socket.on('error', () => undefined));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');

  const { certPath, keyPath } = createSelfSignedCertificate(365);

  writeFileSync(
    join(directory, 'config.json'),
    JSON.stringify({
      cert: { testing: certPath },
      cuit: '20409509763',
      key: { testing: keyPath },
      puntoVentaPorDefecto: 3,
    }),
  );
});

afterEach(() => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  server.close();
  rmSync(directory, { force: true, recursive: true });
});

describe('estado con WSFEX colgado', () => {
  it('termina con 0 y sin la exportación', async () => {
    const result = await runStatus(`return { app: 'OK', auth: 'OK', db: 'OK' };`);

    expect(sockets.size).toBeGreaterThan(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({ listo: true, servidoresExportacion: null });
    expect(result.code).toBe(0);
    expect(result.elapsed).toBeLessThan(MAX_WAIT_MS);
  }, 60_000);

  it('si lo de siempre falla, sale con 1 sin esperar a WSFEX', async () => {
    const result = await runStatus(
      `await new Promise((done) => setTimeout(done, 1000)); throw new Error('socket hang up');`,
    );

    expect(sockets.size).toBeGreaterThan(0);
    expect(JSON.parse(result.stderr)).toMatchObject({ codigo: 'ARCA_UNAVAILABLE' });
    expect(result.code).toBe(1);
    expect(result.elapsed).toBeLessThan(MAX_WAIT_MS);
  }, 60_000);
});
