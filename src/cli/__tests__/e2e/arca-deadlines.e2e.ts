import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ARCA_HOSTS,
  type ArcaServer,
  DEADLINES_MS,
  PROXY_VARIABLES,
  startArcaServer,
} from '../../../testing/arca-server';

/**
 * ARQ-11: el `arcli` compilado contra un ARCA local que no contesta. Vencido el plazo (acortado), muestra el
 * error y el proceso termina solo: no queda una conexión, un timer ni otra consulta en vuelo. Nada sale a la red.
 */
const CLI = resolve('dist/cli/index.js');
/** De sobra para arrancar y vencer el plazo más largo, acortado. */
const HANG_MS = 45_000;
/** Menos que en los otros tests: acá el reloj es de otro proceso y los plazos vencen por tiempo, también con la CPU cargada. */
const DEADLINE_SCALE = 15;

let directory = '';
let server: ArcaServer;

const file = (name: string): string => join(directory, name);

/** Lo mismo que `redirectNetwork` y `trackDeadlines`, en el proceso de `arcli`. */
function preload(): string {
  writeFileSync(
    file('arca.mjs'),
    `import { appendFileSync } from 'node:fs';
     import dns from 'node:dns';
     import https from 'node:https';
     import { syncBuiltinESMExports } from 'node:module';
     import net from 'node:net';
     const block = (target) => {
       appendFileSync(${JSON.stringify(file('red.txt'))}, target + '\\n');
       throw new Error('Este test no puede usar la red: ' + target);
     };
     const { connect } = net.Socket.prototype;
     net.Socket.prototype.connect = function (...args) {
       const flat = args.flat();
       const options = flat.find((arg) => typeof arg === 'object' && arg !== null);
       const done = flat.find((arg) => typeof arg === 'function');
       return ${JSON.stringify(ARCA_HOSTS)}.includes(options?.host)
         ? connect.call(this, { host: '127.0.0.1', port: ${server.port} }, done)
         : block(options?.host + ':' + options?.port);
     };
     dns.lookup = (host) => block('dns ' + host);
     https.globalAgent.options.ca = ${JSON.stringify(server.cert)};
     syncBuiltinESMExports();
     const deadlines = ${JSON.stringify(DEADLINES_MS)};
     const shorten = (ms) => (deadlines.includes(ms) ? ms / ${DEADLINE_SCALE} : ms);
     const { setTimeout } = globalThis;
     globalThis.setTimeout = Object.assign((run, ms, ...args) => setTimeout(run, shorten(ms), ...args), setTimeout);
     const { timeout } = AbortSignal;
     AbortSignal.timeout = (ms) => timeout.call(AbortSignal, shorten(ms));`,
  );

  return pathToFileURL(file('arca.mjs')).href;
}

async function run(args: readonly string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ARCLI_CONFIG_DIR: directory,
    FORCE_COLOR: '0',
    HOME: directory,
    NO_UPDATE_NOTIFIER: '1',
    USERPROFILE: directory,
  };

  PROXY_VARIABLES.forEach((name) => delete env[name]);

  const child = spawn(process.execPath, ['--import', preload(), CLI, ...args, '--json'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const read = { stderr: '', stdout: '' };
  let killed = false;

  for (const name of ['stdout', 'stderr'] as const) {
    child[name].setEncoding('utf8').on('data', (chunk: string) => (read[name] += chunk));
  }

  const timer = setTimeout(() => {
    killed = true;
    child.kill('SIGKILL');
  }, HANG_MS);
  const [code] = (await once(child, 'close')) as [number | null];

  clearTimeout(timer);
  expect(existsSync(file('red.txt')) ? readFileSync(file('red.txt'), 'utf8') : '').toBe('');

  return { code, killed, ...read };
}

const INVOICE = ['fc', '-m', '1000', '--cs', '--cfinal', '--emitir'];
const EXPORT_INVOICE = [
  ...['fe', '--cliente', 'ACME LLC', '--domicilio-cliente', '123 Main St', '--pais-destino', '212'],
  ...['--cuit-pais', '55000002126', '-m', '1500', '--moneda', 'PES', '--item', '001|Consultoria|1|1500|7', '--emitir'],
];

beforeAll(() => {
  if (!existsSync(CLI)) {
    throw new Error('No está dist/cli/index.js: corré `yarn build` antes de `yarn test:e2e`.');
  }
});

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'arcli-plazos-'));
  server = await startArcaServer({ redirect: false });
  writeFileSync(file('cert.pem'), server.cert);
  writeFileSync(file('key.pem'), server.key);
  writeFileSync(
    file('config.json'),
    JSON.stringify({
      cert: { testing: file('cert.pem') },
      consultarPadron: false,
      cuit: '20123456786',
      exportacion: { actividad: 620100 },
      key: { testing: file('key.pem') },
      pdf: 'nunca',
      puntoVentaPorDefecto: 3,
    }),
  );
});

afterEach(async () => {
  await server.stop();
  rmSync(directory, { force: true, recursive: true });
});

describe('si ARCA contesta', () => {
  it('emite una vez y termina sin esperar ningún plazo', async () => {
    const result = await run(INVOICE);

    expect(result).toMatchObject({ code: 0, killed: false, stderr: '' });
    expect(JSON.parse(result.stdout)).toMatchObject({ cae: '75123456789012', numero: 42 });
    expect(server.count('FECAESolicitar')).toBe(1);
  });
});

describe('si ARCA no contesta, avisa y el proceso termina', () => {
  it.each([
    ['una consulta', ['ultimos', 'fc'], 'FECompUltimoAutorizado', 'cuelga', 'UNEXPECTED_ERROR'],
    ['una consulta que gotea', ['ultimos', 'fc'], 'FECompUltimoAutorizado', 'gotea', 'UNEXPECTED_ERROR'],
    ['el login', INVOICE, 'loginCms', 'cuelga', 'UNEXPECTED_ERROR'],
    ['la emisión', INVOICE, 'FECAESolicitar', 'cuelga', 'EMISSION_UNCERTAIN'],
    ['la emisión de la E', EXPORT_INVOICE, 'FEXAuthorize', 'gotea', 'EMISSION_UNCERTAIN'],
  ] as const)('%s', async (_name, args, operation, behavior, codigo) => {
    server.respond((name) => (name === operation ? behavior : undefined));

    const result = await run(args);

    expect(result).toMatchObject({ code: 1, killed: false, stdout: '' });
    expect(JSON.parse(result.stderr)).toMatchObject({ codigo });
    expect(server.count(operation)).toBe(1);
  });

  it('las tablas de la E que quedaron en vuelo tampoco lo dejan vivo', async () => {
    server.respond((name) =>
      ['FEXGetPARAM_DST_CUIT', 'FEXGetPARAM_Idiomas', 'FEXGetPARAM_MON'].includes(name) ? 'cuelga' : undefined,
    );

    const result = await run(EXPORT_INVOICE);

    expect(result).toMatchObject({ code: 1, killed: false, stdout: '' });
    expect(server.count('FEXAuthorize')).toBe(0);
  });
});
