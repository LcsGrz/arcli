import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createSelfSignedCertificate,
  OPENSSL_WARM_UP_TIMEOUT_MS,
  removeSelfSignedCertificates,
} from '../../../lib/security/__tests__/self-signed-certificate';

/**
 * ARQ-11: el `arcli` compilado, interrumpido con señales de verdad mientras ARCA (falso, sin red) no contesta. La
 * llamada que se demora avisa con un archivo que ya le llegó, y contesta cuando aparece otro: nada depende de la
 * velocidad. En Windows `child.kill` mata sin avisar: ahí la lógica la cubre `interrupted-emission.test.ts`.
 *
 * Ningún proceso queda vivo: cada uno se mata a los `HANG_MS` (y el test falla) y otra vez al terminar el test.
 */
const CLI = resolve('dist/cli/index.js');
const CUIT = '20409509763';
const HEALTHY_DAYS = 365;
const HANG_MS = 15_000;
/** Para que el proceso atienda una señal antes de la siguiente: dos iguales pendientes son una. */
const SIGNAL_MS = 200;

interface Interrupted {
  readonly code: number | null;
  readonly killed: boolean;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly stdout: string;
}

interface RunOptions {
  /** ARCA contesta después de las señales. Sin esto no contesta nunca. */
  readonly answers?: boolean;
  readonly closeStdout?: boolean;
  /** La llamada que se demora, y cuál (desde 1). */
  readonly hold: readonly [method: string, call: number];
  readonly preloads?: readonly string[];
  readonly signals: readonly NodeJS.Signals[];
}

let directory = '';
let running: ChildProcess | undefined;

const file = (name: string): string => join(directory, name);

const plain = (text: string): string => text.replace(/[│┃║╏╎┊▎\s]+/g, ' ');

function writePreload(name: string, source: string): string {
  writeFileSync(file(name), source);

  return pathToFileURL(file(name)).href;
}

/** Nada sale a la red: cada intento falla y queda anotado en `red.txt`. */
function blockNetwork(): string {
  return writePreload(
    'red.mjs',
    `import { appendFileSync } from 'node:fs';
     import dns from 'node:dns';
     import { syncBuiltinESMExports } from 'node:module';
     import net from 'node:net';
     const block = (target, name) => {
       target[name] = () => {
         appendFileSync(${JSON.stringify(file('red.txt'))}, name + '\\n');
         throw new Error('Este test no puede usar la red: ' + name);
       };
     };
     block(net.Socket.prototype, 'connect');
     for (const target of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
       for (const name of Object.getOwnPropertyNames(target)) {
         if (/^(lookup|resolve|reverse)/.test(name)) block(target, name);
       }
     }
     syncBuiltinESMExports();`,
  );
}

/** WSFE y WSFEX falsos. Lo enviado queda en `enviados.txt`; la llamada demorada, en `llego`, hasta que exista `seguir`. */
function fakeArca([method, call]: RunOptions['hold']): string {
  const dist = (path: string): string => JSON.stringify(pathToFileURL(resolve('dist/services/arca', path)).href);

  return writePreload(
    'arca.mjs',
    `import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
     import { setTimeout } from 'node:timers/promises';
     import { ArcaBillingGateway } from ${dist('arca-billing.gateway.js')};
     import { ArcaExportGateway } from ${dist('arca-export.gateway.js')};
     let calls = 0;
     const hold = async (name) => {
       if (name !== ${JSON.stringify(method)} || (calls += 1) !== ${call}) return;
       writeFileSync(${JSON.stringify(file('llego'))}, '');
       while (!existsSync(${JSON.stringify(file('seguir'))})) await setTimeout(10);
     };
     const note = (number) => appendFileSync(${JSON.stringify(file('enviados.txt'))}, number + '\\n');
     let number = 41;
     ArcaBillingGateway.prototype.getNextVoucherNumber = async () => {
       await hold('getNextVoucherNumber');
       return number + 1;
     };
     const { createVoucher } = ArcaBillingGateway.prototype;
     ArcaBillingGateway.prototype.createVoucher = async () => {
       number += 1;
       note(number);
       await hold('createVoucher');
       const answer = { cae: '75123456789012', caeFchVto: '20991231', response: { FeDetResp: { FECAEDetResponse: [
         { CbteDesde: number, CbteHasta: number, Resultado: 'A' },
       ] } } };
       return createVoucher.call({ arca: { electronicBillingService: { createVoucher: async () => answer } } });
     };
     const answers = {
       getActivities: [{ id: 620100, name: 'SERVICIOS' }], getCurrencies: [{ code: 'DOL', name: 'Dolar' }],
       getDestinationCountries: [{ code: 212, name: 'ESTADOS UNIDOS' }],
       getDestinationCountryCuits: [{ countryName: 'ESTADOS UNIDOS - Persona Juridica', cuit: 55000002126 }],
       getIncoterms: [], getLanguages: [{ id: 1, name: 'Espanol' }], getLastRequestId: 7, getLastVoucherNumber: 8,
       getQuotations: [], getUnits: [{ id: 7, name: 'unidades' }],
     };
     for (const [name, answer] of Object.entries(answers)) {
       ArcaExportGateway.prototype[name] = async () => { await hold(name); return answer; };
     }
     ArcaExportGateway.prototype.authorize = async (payload) => {
       note(payload.Cbte_nro);
       await hold('authorize');
       throw new Error('ARCA no respondió');
     };`,
  );
}

/** Una terminal, para que el spinner se muestre y esconda el cursor. */
function fakeTerminal(): string {
  return writePreload(
    'terminal.mjs',
    `import { clearLine, cursorTo, moveCursor } from 'node:readline';
     delete process.env.CI;
     process.env.TERM = 'xterm';
     for (const stream of [process.stdout, process.stderr]) {
       Object.assign(stream, {
         clearLine: (...args) => clearLine(stream, ...args), columns: 120, cursorTo: (...args) => cursorTo(stream, ...args),
         getColorDepth: () => 1, getWindowSize: () => [120, 60], hasColors: () => false, isTTY: true,
         moveCursor: (...args) => moveCursor(stream, ...args), rows: 60,
       });
     }`,
  );
}

async function waitFor(done: () => boolean, what: string): Promise<void> {
  for (const deadline = Date.now() + HANG_MS; !done();) {
    if (Date.now() > deadline) {
      throw new Error(`No pasó: ${what}`);
    }

    await pause(10);
  }
}

/** Corre `arcli`, espera a que ARCA reciba la llamada que se demora y manda las señales. */
async function run(args: readonly string[], options: RunOptions): Promise<Interrupted> {
  const preloads = [blockNetwork(), fakeArca(options.hold), ...(options.preloads ?? [])];
  const child = spawn(process.execPath, [...preloads.flatMap((preload) => ['--import', preload]), CLI, ...args], {
    env: {
      ...process.env,
      ARCLI_CONFIG_DIR: directory,
      FORCE_COLOR: '0',
      HOME: directory,
      NO_UPDATE_NOTIFIER: '1',
      USERPROFILE: directory,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const read = { stderr: '', stdout: '' };
  const closed = once(child, 'close') as Promise<[number | null, NodeJS.Signals | null]>;
  let killed = false;

  running = child;

  for (const name of ['stdout', 'stderr'] as const) {
    child[name].setEncoding('utf8').on('data', (chunk: string) => (read[name] += chunk));
  }

  if (options.closeStdout) {
    child.stdout.destroy();
  }

  await waitFor(() => existsSync(file('llego')) || child.exitCode !== null, 'la llamada a ARCA');

  for (const signal of options.signals) {
    child.kill(signal);
    await pause(SIGNAL_MS);
  }

  if (options.answers) {
    writeFileSync(file('seguir'), '');
  }

  const timer = setTimeout(() => {
    killed = true;
    child.kill('SIGKILL');
  }, HANG_MS);
  const [code, signal] = await closed;

  clearTimeout(timer);

  if (existsSync(file('red.txt'))) {
    throw new Error(`Intentó usar la red: ${readFileSync(file('red.txt'), 'utf8').trim()}`);
  }

  return { code, killed, signal, ...read };
}

const sent = (): string[] =>
  existsSync(file('enviados.txt')) ? readFileSync(file('enviados.txt'), 'utf8').trim().split('\n') : [];

/** Como corta hoy una señal: por ella, o con 130. */
const cutBySignal = ({ code, killed, signal }: Interrupted): boolean =>
  !killed && (code === 130 || signal === 'SIGINT');

const INVOICE = ['fc', '-m', '1000', '--cs', '--cfinal', '--emitir'];
const EXPORT_INVOICE = [
  ...['fe', '-m', '1500', '--cm', '1000', '--cliente', 'ACME LLC', '--domicilio-cliente', '123 Main St'],
  ...['--pais-destino', '212', '--cuit-pais', '55000002126', '--emitir'],
];
const batch = (): string[] => ['fc', '--cargar', file('lote.json'), '--emitir'];

beforeAll(() => {
  if (!existsSync(CLI)) {
    throw new Error('No está dist/cli/index.js: corré `yarn build` antes de `yarn test:e2e`.');
  }

  createSelfSignedCertificate(HEALTHY_DAYS);
}, OPENSSL_WARM_UP_TIMEOUT_MS);

afterAll(removeSelfSignedCertificates);

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'arcli-interrupted-'));

  const { certPath, keyPath } = createSelfSignedCertificate(HEALTHY_DAYS);
  const item = {
    concepto: 'servicios',
    ivaReceptor: 'consumidor-final',
    montoTotal: 1000,
    tipoDocumento: 'consumidor-final',
  };

  writeFileSync(
    file('config.json'),
    JSON.stringify({
      cert: { testing: certPath },
      cuit: CUIT,
      emisor: { domicilio: 'Calle 1', inicioActividades: '20200101', razonSocial: 'Prueba' },
      key: { testing: keyPath },
      pdf: 'nunca',
      puntoVentaPorDefecto: 3,
    }),
  );
  writeFileSync(file('lote.json'), JSON.stringify([item, item, item]));
});

afterEach(() => {
  if (running?.exitCode === null && running.signalCode === null) {
    running.kill('SIGKILL');
  }

  running = undefined;
  rmSync(directory, { force: true, recursive: true });
});

describe.skipIf(process.platform === 'win32')('un lote interrumpido en el 2.º', () => {
  it.each(['SIGINT', 'SIGTERM'] as const)(
    'una señal (%s), --json: 2 CAE, el 3.º sin procesar y exit 1',
    async (signal) => {
      const result = await run([...batch(), '--json'], {
        answers: true,
        hold: ['createVoucher', 2],
        signals: [signal],
      });

      expect(sent()).toEqual(['42', '43']);
      expect(result).toMatchObject({ code: 1, killed: false, signal: null });
      expect((JSON.parse(result.stdout) as Array<{ numero: number }>).map(({ numero }) => numero)).toEqual([42, 43]);
      expect(JSON.parse(result.stderr)).toMatchObject({
        codigo: 'BATCH_EMISSION_ERROR',
        detalles: { codigoCausa: 'CANCELLED', procesados: 2, sinProcesar: [3], total: 3 },
      });
    },
  );

  it('una señal, en texto: los 2 CAE y qué falta', async () => {
    const result = await run(batch(), { answers: true, hold: ['createVoucher', 2], signals: ['SIGINT'] });

    expect(sent()).toEqual(['42', '43']);
    expect(result).toMatchObject({ code: 1, killed: false, signal: null });
    expect(result.stdout.match(/75123456789012/g)).toHaveLength(2);
    expect(plain(result.stderr)).toContain('Sin procesar: #3.');
  });

  it('dos señales: el CAE del 1.º, el 2.º sin confirmar y corta por la señal, sin esperar a ARCA', async () => {
    const result = await run([...batch(), '--json'], {
      hold: ['createVoucher', 2],
      signals: ['SIGINT', 'SIGINT'],
    });

    expect(sent()).toEqual(['42', '43']);
    expect(result.stdout).toContain('75123456789012');
    expect(JSON.parse(result.stdout)).toMatchObject([{ cae: '75123456789012', numero: 42 }]);
    expect(JSON.parse(result.stderr)).toMatchObject({
      codigo: 'BATCH_EMISSION_ERROR',
      detalles: { procesados: 1, sinConfirmar: 2, sinProcesar: [3], total: 3 },
    });
    expect(result.stderr).not.toMatch(/no se (emitió|envió)/i);
    expect(cutBySignal(result)).toBe(true);
  });

  it('muchas señales seguidas: lo mismo, un solo documento por salida', async () => {
    const result = await run([...batch(), '--json'], {
      hold: ['createVoucher', 2],
      signals: ['SIGINT', 'SIGINT', 'SIGINT', 'SIGINT'],
    });

    expect(sent()).toEqual(['42', '43']);
    expect(result.stdout).toContain('75123456789012');
    expect(JSON.parse(result.stdout)).toHaveLength(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ detalles: { sinConfirmar: 2, sinProcesar: [3] } });
    expect(cutBySignal(result)).toBe(true);
  });

  it('una señal en el último: los 3 CAE y exit 0', async () => {
    const result = await run([...batch(), '--json'], {
      answers: true,
      hold: ['createVoucher', 3],
      signals: ['SIGINT'],
    });

    expect(sent()).toEqual(['42', '43', '44']);
    expect(result).toMatchObject({ code: 0, killed: false, signal: null });
    expect(JSON.parse(result.stdout)).toHaveLength(3);
  });

  it('una señal al pedir el número del 2.º: el CAE del 1.º, y el 2.º no se envía', async () => {
    const result = await run([...batch(), '--json'], {
      answers: true,
      hold: ['getNextVoucherNumber', 2],
      signals: ['SIGINT'],
    });

    expect(sent()).toEqual(['42']);
    expect(result).toMatchObject({ code: 1, killed: false, signal: null });
    expect(JSON.parse(result.stdout)).toHaveLength(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ detalles: { procesados: 1, sinProcesar: [2, 3] } });
  });

  it('con stdout cerrado, el error igual sale con lo procesado', async () => {
    const result = await run(batch(), {
      answers: true,
      closeStdout: true,
      hold: ['createVoucher', 2],
      signals: ['SIGINT'],
    });

    expect(sent()).toEqual(['42', '43']);
    expect(result).toMatchObject({ code: 1, killed: false, signal: null });
    expect(plain(result.stderr)).toContain('Procesados: 2 de 3.');
  });
});

describe.skipIf(process.platform === 'win32')('un comprobante interrumpido', () => {
  // No quedó nada pendiente: el exit code de siempre.
  it('una señal y ARCA contesta: avisa, espera y muestra el CAE', async () => {
    const result = await run(INVOICE, { answers: true, hold: ['createVoucher', 1], signals: ['SIGINT'] });

    expect(sent()).toEqual(['42']);
    expect(result).toMatchObject({ code: 0, killed: false, signal: null });
    expect(result.stdout).toContain('75123456789012');
    expect(result.stdout + result.stderr).toMatch(/esper/i);
  });

  it.each([
    ['fc', INVOICE, 'createVoucher', '42', 'arcli ultimos fc --pv 3 --testing'],
    ['fe', EXPORT_INVOICE, 'authorize', '9', 'arcli consultar fe 9 --pv 3 --testing'],
  ] as const)(
    'dos señales (%s): dice que no se sabe, con qué verificarlo, y corta',
    async (_name, args, method, number, verify) => {
      const result = await run([...args, '--json'], { hold: [method, 1], signals: ['SIGINT', 'SIGINT'] });

      expect(sent()).toEqual([number]);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('EMISSION_UNCERTAIN');
      expect(JSON.parse(result.stderr)).toMatchObject({
        codigo: 'EMISSION_UNCERTAIN',
        sugerencia: expect.stringContaining(verify),
      });
      expect(cutBySignal(result)).toBe(true);
    },
  );
});

describe.skipIf(process.platform === 'win32')('sin nada enviado, una señal corta como siempre', () => {
  it.each([
    ['al pedir el número', INVOICE, 'getNextVoucherNumber'],
    ['al pedir el número del 1.º de un lote', undefined, 'getNextVoucherNumber'],
    ['consultando WSFEX', EXPORT_INVOICE, 'getLastVoucherNumber'],
  ] as const)('%s', async (_name, args, method) => {
    const result = await run(args ?? batch(), { hold: [method, 1], signals: ['SIGINT'] });

    expect(cutBySignal(result)).toBe(true);
    expect(sent()).toEqual([]);
    expect(result).toMatchObject({ stderr: '', stdout: '' });
  });

  it('SIGTERM también', async () => {
    const result = await run(INVOICE, { hold: ['getNextVoucherNumber', 1], signals: ['SIGTERM'] });

    expect(result).toMatchObject({ killed: false, signal: 'SIGTERM', stderr: '', stdout: '' });
    expect(sent()).toEqual([]);
  });
});

describe.skipIf(process.platform === 'win32')('el cursor que escondió el spinner', () => {
  /** Lo último que se hizo con el cursor, de las dos salidas: el spinner usa una sola. */
  const cursor = ({ stderr, stdout }: Interrupted): string | undefined =>
    // eslint-disable-next-line no-control-regex
    (stdout + stderr).match(/\u001B\[\?25[hl]/g)?.at(-1);

  it('vuelve: antes de enviar', async () => {
    const result = await run(INVOICE, {
      hold: ['getNextVoucherNumber', 1],
      preloads: [fakeTerminal()],
      signals: ['SIGINT'],
    });

    expect(sent()).toEqual([]);
    expect(result.stdout + result.stderr).toContain('\u001B[?25l');
    expect(cursor(result)).toBe('\u001B[?25h');
  });

  it('vuelve: con una señal y la respuesta', async () => {
    const result = await run(INVOICE, {
      answers: true,
      hold: ['createVoucher', 1],
      preloads: [fakeTerminal()],
      signals: ['SIGINT'],
    });

    expect(result.stdout).toContain('75123456789012');
    expect(cursor(result)).toBe('\u001B[?25h');
  });

  it('vuelve: con dos señales', async () => {
    const result = await run(INVOICE, {
      hold: ['createVoucher', 1],
      preloads: [fakeTerminal()],
      signals: ['SIGINT', 'SIGINT'],
    });

    expect(plain(result.stderr)).toContain('arcli ultimos fc --pv 3 --testing');
    expect(cursor(result)).toBe('\u001B[?25h');
    expect(cutBySignal(result)).toBe(true);
  });
});
