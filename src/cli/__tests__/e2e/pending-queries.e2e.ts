import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { type AddressInfo, createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createSelfSignedCertificate,
  OPENSSL_WARM_UP_TIMEOUT_MS,
  removeSelfSignedCertificates,
} from '../../../lib/security/__tests__/self-signed-certificate';

/**
 * El `arcli` compilado con ARCA y npm que aceptan la conexion y no contestan (TUI-49). Sin red externa: un preload
 * manda cualquier conexion a un servidor local que se queda callado, y hace creer que hay una terminal. Los topes de
 * las consultas se llevan a un minuto: si algo las espera, el test no termina.
 */
const CLI = resolve('dist/cli/index.js');
/** Lo que tarda el equipo en arrancar, de sobra, y bastante menos que los topes. */
const MAX_WAIT_MS = 20_000;

let directory = '';
let server: Server;
const sockets = new Set<Socket>();

function preload(registry: string): string {
  const path = join(directory, 'colgado.mjs');

  writeFileSync(
    path,
    `import dns from 'node:dns';
     import { syncBuiltinESMExports } from 'node:module';
     import { EventEmitter } from 'node:events';
     import https from 'node:https';
     import net from 'node:net';
     import { PassThrough, Readable } from 'node:stream';
     const { connect } = net.Socket.prototype;
     net.Socket.prototype.connect = function (...args) {
       const local = { host: '127.0.0.1', port: ${(server.address() as AddressInfo).port} };
       return connect.call(this, local, args.flat(2).find((arg) => typeof arg === 'function'));
     };
     dns.lookup = (_host, options, done) =>
       (done ?? options)(null, options.all ? [{ address: '127.0.0.1', family: 4 }] : '127.0.0.1', 4);
     syncBuiltinESMExports();
     const { setTimeout } = globalThis;
     globalThis.setTimeout = (run, ms, ...args) => setTimeout(run, ms === 1500 || ms === 5000 ? 60_000 : ms, ...args);
     for (const [stream, size] of [[process.stdin, {}], [process.stdout, { columns: 100, rows: 45 }], [process.stderr, {}]]) {
       Object.assign(stream, { isTTY: true, ...size });
     }
     process.stdin.setRawMode = () => process.stdin;
     const answer = (body) => {
       https.get = (_url, _options, onResponse) => {
         const request = new EventEmitter();
         const response = Object.assign(body === undefined ? new PassThrough() : Readable.from([body]), { statusCode: 200 });
         process.nextTick(() =>
           body === undefined ? request.emit('error', new Error('sin red')) : onResponse(response));
         return request;
       };
       syncBuiltinESMExports();
     };
     ${registry}`,
  );

  return pathToFileURL(path).href;
}

/** Lo leido hasta ahora, sin colores en stdout, y el proceso, para reaccionar a lo que se ve. */
type OnOutput = (
  read: { readonly stderr: string; readonly stdout: string },
  child: ChildProcessWithoutNullStreams,
) => void;

async function run(
  args: readonly string[],
  options: {
    readonly keys?: string;
    readonly onOutput?: OnOutput;
    readonly registry?: string;
    readonly skipUpdates?: boolean;
  } = {},
) {
  const start = Date.now();
  const child = spawn(process.execPath, ['--import', preload(options.registry ?? ''), CLI, ...args], {
    env: {
      ...process.env,
      ARCLI_CONFIG_DIR: directory,
      CI: '',
      FORCE_COLOR: '0',
      HOME: directory,
      NO_UPDATE_NOTIFIER: options.skipUpdates ? '1' : '',
      USERPROFILE: directory,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  const read = { stderr: '', stdout: '' };
  let keys = options.keys;

  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    read.stdout += chunk;

    // Con el menu ya dibujado y las conexiones abiertas.
    if (keys !== undefined && stripVTControlCharacters(read.stdout).includes('para filtrar')) {
      const pressed = keys;

      keys = undefined;

      const send = (): void => {
        if (sockets.size >= 2) {
          child.stdin.write(pressed);
        } else {
          setTimeout(send, 20);
        }
      };

      send();
    }

    options.onOutput?.({ stderr: read.stderr, stdout: stripVTControlCharacters(read.stdout) }, child);
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    read.stderr += chunk;
    options.onOutput?.({ stderr: read.stderr, stdout: stripVTControlCharacters(read.stdout) }, child);
  });

  const [code] = (await once(child, 'close')) as [number | null];

  return { code, elapsed: Date.now() - start, stderr: read.stderr, stdout: stripVTControlCharacters(read.stdout) };
}

/** `estado` con ARCA de mentira que tarda: npm contesta antes de que termine. */
function slowStatus(): string {
  const gateway = pathToFileURL(resolve('dist/services/arca/arca-parameters.gateway.js')).href;

  return `
     const { ArcaParametersGateway } = await import(${JSON.stringify(gateway)});
     const { createRequire } = await import('node:module');
     const { SoapClient } = createRequire(${JSON.stringify(pathToFileURL(CLI).href)})('@arcasdk/core');
     SoapClient.prototype.createClient = async () => { throw new Error('sin WSFEX'); };
     ArcaParametersGateway.prototype.getServerStatus = async () => {
       await new Promise((done) => setTimeout(done, 500));
       return { app: 'OK', auth: 'OK', db: 'OK' };
     };
     ArcaParametersGateway.prototype.getSalesPoints = async () => [];`;
}

const cachePath = () => join(directory, 'update-cache.json');
const lastCheckedAt = (): number =>
  existsSync(cachePath())
    ? (JSON.parse(readFileSync(cachePath(), 'utf8')) as { lastCheckedAt: number }).lastCheckedAt
    : 0;
const cacheVersion = (latestVersion: string) =>
  writeFileSync(cachePath(), JSON.stringify({ lastCheckedAt: 1, latestVersion }));

beforeAll(() => {
  createSelfSignedCertificate(365);
}, OPENSSL_WARM_UP_TIMEOUT_MS);

afterAll(removeSelfSignedCertificates);

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'arcli-pendientes-'));
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

describe('un comando con npm colgado', () => {
  it('termina sin esperarlo y sin anotar la consulta', async () => {
    const result = await run(['config', 'ruta']);

    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout).toContain(directory);
    expect(result.elapsed).toBeLessThan(MAX_WAIT_MS);
    expect(lastCheckedAt()).toBe(0);
  }, 70_000);

  it('con una versión más nueva ya guardada, avisa con esa por stderr', async () => {
    cacheVersion('99.0.0');

    const result = await run(['config', 'ruta']);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('99.0.0');
    expect(result.stdout).not.toContain('99.0.0');
    expect(result.elapsed).toBeLessThan(MAX_WAIT_MS);
    expect(lastCheckedAt()).toBe(1);
  }, 70_000);

  it('si el comando falla, tampoco espera ni avisa', async () => {
    cacheVersion('99.0.0');

    const result = await run(['consultar', 'fc']);

    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain('99.0.0');
    expect(result.elapsed).toBeLessThan(MAX_WAIT_MS);
    expect(lastCheckedAt()).toBe(1);
  }, 70_000);
});

describe('un comando sin npm colgado', () => {
  it('lo que llega antes de terminar se avisa y se anota', async () => {
    const result = await run(['estado'], {
      registry: `${slowStatus()} answer('{"version":"99.0.0"}');`,
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('99.0.0');
    expect(lastCheckedAt()).toBeGreaterThan(1);
  }, 70_000);

  it('con npm caído, termina igual y no avisa', async () => {
    const result = await run(['config', 'ruta'], {
      registry: `answer();`,
    });

    expect(result).toMatchObject({ code: 0, stderr: '' });
  }, 70_000);

  it.each([
    ['--json', ['config', 'ver', '--json'], false],
    ['autocompletado', ['__completar', 'arcli', ''], false],
    ['NO_UPDATE_NOTIFIER', ['config', 'ruta'], true],
  ])(
    '%s: ni consulta ni avisa',
    async (_name, args, skipUpdates) => {
      cacheVersion('99.0.0');

      const result = await run(args, { skipUpdates });

      expect(result.stderr).not.toContain('99.0.0');
      expect(sockets.size).toBe(0);
      expect(lastCheckedAt()).toBe(1);
    },
    70_000,
  );
});

describe('la consulta a npm con NODE_USE_ENV_PROXY', () => {
  it.each([
    ['1', ['CONNECT registro.invalid:443 HTTP/1.1']],
    ['0', []],
  ])(
    '%s',
    async (useProxy, expected) => {
      const requests: string[] = [];
      const proxy = createServer((socket) => {
        socket
          .on('error', () => undefined)
          .once('data', (data) => {
            requests.push(String(data).split('\r\n')[0] ?? '');
            socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
          });
      }).listen(0, '127.0.0.1');

      await once(proxy, 'listening');

      try {
        const module = pathToFileURL(resolve('dist/services/npm/npm-registry.js')).href;
        // `.invalid` no existe: sin proxy no sale a ningun lado.
        const script = `import { requestNpmRegistry } from ${JSON.stringify(module)};
         requestNpmRegistry('https://registro.invalid/arcli', { signal: new AbortController().signal })
           .then(() => process.exit(3), () => undefined);`;
        const url = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
        const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
          env: {
            ...process.env,
            HTTPS_PROXY: url,
            https_proxy: url,
            NODE_USE_ENV_PROXY: useProxy,
            NO_PROXY: '',
            no_proxy: '',
          },
          stdio: 'ignore',
          timeout: 60_000,
        });
        const [code] = (await once(child, 'close')) as [number | null];

        expect(code).toBe(0);
        expect(requests).toEqual(expected);
      } finally {
        proxy.close();
      }
    },
    70_000,
  );
});

describe('el asistente con ARCA y npm colgados', () => {
  it.each([
    ['Esc', '\u001B'],
    ['Ctrl+C', '\u0003'],
    ['Salir', `${'\u001B[B'.repeat(8)}\r`],
  ])(
    '%s cierra el proceso enseguida',
    async (_name, keys) => {
      const result = await run([], { keys });

      expect(result).toMatchObject({ code: 0, stderr: '' });
      expect(result.stdout).toContain('COMPROBANDO ARCA');
      expect(result.stdout).toContain('¡Hasta la próxima!');
      expect(result.stdout.trimEnd()).toMatch(/arcli\.com\.ar\S*$/);
      expect(result.elapsed).toBeLessThan(MAX_WAIT_MS);
      expect(lastCheckedAt()).toBe(0);
    },
    70_000,
  );
});

// En Windows `child.kill('SIGINT')` termina el proceso sin dar la señal, como en interrupted-emission.e2e.ts.
describe.skipIf(process.platform === 'win32')('Ctrl+C en el asistente con ARCA colgado (ARQ-11 PR 5)', () => {
  const MENU = '¿Qué querés hacer?';
  const count = (text: string, part: string) => text.split(part).length - 1;

  it('en "Estado de ARCA" vuelve al menú con "Cancelado."; después Esc sale con 0', async () => {
    let menusAtCut: number | undefined;
    let isLeaving = false;
    const result = await run([], {
      // "Estado de ARCA" es la séptima opción.
      keys: `${'\u001B[B'.repeat(6)}\r`,
      onOutput: ({ stderr, stdout }, child) => {
        if (menusAtCut === undefined && stripVTControlCharacters(stderr + stdout).includes('Consultando ARCA...')) {
          menusAtCut = count(stdout, MENU);
          child.kill('SIGINT');
        } else if (menusAtCut !== undefined && !isLeaving && count(stdout, MENU) > menusAtCut) {
          isLeaving = true;
          child.stdin.write('\u001B');
        }
      },
    });

    expect(menusAtCut, 'nunca se vio "Consultando ARCA..."').toBeDefined();
    expect(result.code, 'la señal cortó el proceso').toBe(0);
    expect(result.stdout).toContain('Cancelado.');
    expect(result.stdout).not.toContain('No se emitió nada');
    expect(result.stdout).toContain('¡Hasta la próxima!');
    expect(result.elapsed).toBeLessThan(MAX_WAIT_MS);
  }, 70_000);
});
