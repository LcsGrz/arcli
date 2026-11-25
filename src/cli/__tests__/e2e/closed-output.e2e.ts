import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
import { PDF_PLUGIN_VERSION } from '../../../services/pdf/pdf-plugin';

/**
 * ARQ-16: quien lee la salida la corta (`arcli ayuda | head`). El `arcli` compilado, con el extremo de lectura ya
 * cerrado cuando empieza a escribir: un preload lo hace esperar un archivo que se crea recien despues de cerrar, asi
 * que no depende de la velocidad de nadie. Sin red: donde se emite, un preload reemplaza la llamada a ARCA y, en
 * todos, otro hace fallar cualquier conexion o consulta de DNS (y el test, aunque el CLI se trague el error).
 *
 * No se afirma el codigo con el que cada sistema avisa el cierre: si alguno usa otro que EPIPE, stderr lo muestra y
 * el test falla con ese texto. El CI los corre en Linux, macOS y Windows.
 */
const CLI = resolve('dist/cli/index.js');
const CUIT = '20409509763';
const HEALTHY_DAYS = 365;
const EXPIRING_DAYS = 10;
/** Por si el test se corta antes de abrir la compuerta: que el proceso no quede esperando. */
const GATE_TIMEOUT_MS = 30_000;
const OUTPUTS = ['stdout', 'stderr'] as const;

type OutputName = (typeof OUTPUTS)[number];

interface Run {
  readonly code: number | null;
  /** Vacia si se cerro. */
  readonly stderr: string;
  readonly stdout: string;
}

let directory = '';

const file = (name: string): string => join(directory, name);

function writePreload(name: string, source: string): string {
  writeFileSync(file(name), source);

  return pathToFileURL(file(name)).href;
}

/** Nada sale a la red: cada intento falla y queda anotado en `red.txt`, que `runClosing` revisa. */
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

async function runClosing(
  closed: readonly OutputName[],
  args: readonly string[],
  preloads: readonly string[] = [],
): Promise<Run> {
  const gate = writePreload(
    'gate.mjs',
    `import { existsSync } from 'node:fs';
     const cell = new Int32Array(new SharedArrayBuffer(4));
     const deadline = Date.now() + ${GATE_TIMEOUT_MS};
     while (!existsSync(${JSON.stringify(file('cerrado'))})) {
       if (Date.now() > deadline) process.exit(70);
       Atomics.wait(cell, 0, 0, 10);
     }`,
  );
  const child = spawn(
    process.execPath,
    [...[gate, blockNetwork(), ...preloads].flatMap((preload) => ['--import', preload]), CLI, ...args],
    {
      env: {
        ...process.env,
        ARCLI_CONFIG_DIR: directory,
        FORCE_COLOR: '0',
        HOME: directory,
        NO_UPDATE_NOTIFIER: '1',
        USERPROFILE: directory,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    },
  );
  const read = { stderr: '', stdout: '' };
  const finished = once(child, 'close');

  for (const name of OUTPUTS.filter((output) => !closed.includes(output))) {
    child[name].setEncoding('utf8').on('data', (chunk: string) => (read[name] += chunk));
  }

  await Promise.all(
    closed.map((name) => {
      const done = once(child[name], 'close');

      child[name].destroy();

      return done;
    }),
  );
  writeFileSync(file('cerrado'), '');

  const [code] = (await finished) as [number | null];

  if (existsSync(file('red.txt'))) {
    throw new Error(`Intentó usar la red: ${readFileSync(file('red.txt'), 'utf8').trim().replaceAll('\n', ', ')}`);
  }

  return { code, ...read };
}

/** Reemplaza las dos llamadas a WSFE de la emision y anota cada comprobante en `emitidos.txt`. `failsAt`: ese lanza. */
function fakeArca({ failsAt = 0, result = 'A' }: { failsAt?: number; result?: 'A' | 'R' } = {}): string {
  const gateway = pathToFileURL(resolve('dist/services/arca/arca-billing.gateway.js')).href;

  return writePreload(
    'arca.mjs',
    `import { appendFileSync } from 'node:fs';
     import { setTimeout } from 'node:timers/promises';
     import { ArcaBillingGateway } from ${JSON.stringify(gateway)};
     let number = 41;
     ArcaBillingGateway.prototype.getNextVoucherNumber = async () => { await setTimeout(50); return number + 1; };
     const { createVoucher } = ArcaBillingGateway.prototype;
     const read = (answer) => createVoucher.call({ arca: { electronicBillingService: { createVoucher: async () => answer } } });
     ArcaBillingGateway.prototype.createVoucher = async () => {
       await setTimeout(50);
       number += 1;
       if (number === ${failsAt}) {
         appendFileSync(${JSON.stringify(file('enviado.txt'))}, number + '\\n');
         throw new Error('ARCA no respondió');
       }
       appendFileSync(${JSON.stringify(file('emitidos.txt'))}, number + '\\n');
       return read({
         cae: ${JSON.stringify(result === 'A' ? '75123456789012' : '')},
         caeFchVto: ${JSON.stringify(result === 'A' ? '20991231' : '')},
         response: { FeDetResp: { FECAEDetResponse: [
           { CbteDesde: number, CbteHasta: number, Resultado: ${JSON.stringify(result)} },
         ] } },
       });
     };`,
  );
}

/** Un plugin de PDF que tarda: cuando termina, el comprobante ya se escribio en stdout. */
function fakePdfPlugin(): void {
  const folder = join(directory, 'plugins', 'pdf', 'node_modules', '@arcasdk', 'pdf');

  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ main: 'index.js', version: PDF_PLUGIN_VERSION }));
  writeFileSync(
    join(folder, 'index.js'),
    `exports.InvoicePdfGenerator = class {
       async generate() { await new Promise((done) => setTimeout(done, 100)); return Buffer.from('%PDF-falso'); }
     };`,
  );
}

function configure(options: { readonly days?: number; readonly pdf?: 'nunca' | 'siempre' } = {}): void {
  const { certPath, keyPath } = createSelfSignedCertificate(options.days ?? HEALTHY_DAYS);

  writeFileSync(
    file('config.json'),
    JSON.stringify({
      cert: { testing: certPath },
      cuit: CUIT,
      emisor: { domicilio: 'Calle 1', inicioActividades: '20200101', razonSocial: 'Prueba' },
      key: { testing: keyPath },
      pdf: options.pdf ?? 'nunca',
      pdfCarpeta: file('pdfs'),
      pdfNavegador: process.execPath,
      puntoVentaPorDefecto: 3,
    }),
  );
}

function readConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(file('config.json'), 'utf8')) as Record<string, unknown>;
}

function writeBatch(): void {
  const item = {
    concepto: 'servicios',
    ivaReceptor: 'consumidor-final',
    montoTotal: 1000,
    tipoDocumento: 'consumidor-final',
  };

  writeFileSync(file('lote.json'), JSON.stringify([item, item, item]));
}

function emitted(): string[] {
  return existsSync(file('emitidos.txt')) ? readFileSync(file('emitidos.txt'), 'utf8').trim().split('\n') : [];
}

function pdfs(): string[] {
  const folder = join(directory, 'pdfs', 'testing', CUIT);

  return existsSync(folder) ? readdirSync(folder) : [];
}

interface OutputFailureOptions {
  readonly code?: string;
  /** Cuanto tarda en llegar el error; 0, el turno siguiente. */
  readonly delayMs?: number;
  /** Falla recien cuando esto da verdadero: codigo que corre en el proceso, con `existsSync` y `seen`. */
  readonly when?: string;
}

/** ERR-18: escribir en esas salidas falla como un disco lleno, recien despues de que `write` volvio. */
function failOutput(names: readonly OutputName[], options: OutputFailureOptions = {}): string {
  const { code = 'ENOSPC', delayMs = 0, when = 'true' } = options;

  return writePreload(
    'salida.mjs',
    `import { existsSync } from 'node:fs';
     let seen = '';
     for (const name of ${JSON.stringify(names)}) {
       const stream = process[name];
       const write = stream._write.bind(stream);
       stream._writev = null;
       stream._write = (chunk, encoding, done) => {
         seen += chunk;
         if (!(${when})) { write(chunk, encoding, done); return; }
         const error = Object.assign(new Error('write ${code}'), { code: '${code}', syscall: 'write' });
         if (${delayMs} > 0) setTimeout(done, ${delayMs}, error); else process.nextTick(done, error);
       };
     }`,
  );
}

/**
 * El asistente sin terminal: cada tecla se manda cuando aparece su pregunta, se haya podido escribir o no, como alguien
 * que sigue tecleando. El estado de ARCA (la barra) no se consulta. Va despues de `failOutput`.
 */
function driveAssistant(answers: ReadonlyArray<readonly [question: string, keys: string]>): string {
  const gateway = pathToFileURL(resolve('dist/services/arca/arca-parameters.gateway.js')).href;

  return writePreload(
    'asistente.mjs',
    `import { createRequire } from 'node:module';
     import { PassThrough } from 'node:stream';
     import { stripVTControlCharacters } from 'node:util';
     import { ArcaParametersGateway } from ${JSON.stringify(gateway)};
     for (const name of Object.getOwnPropertyNames(ArcaParametersGateway.prototype)) {
       if (name !== 'constructor') ArcaParametersGateway.prototype[name] = async () => { throw new Error('sin ARCA'); };
     }
     // El FEDummy de la barra, que no pasa por el gateway (\`wsfe-status\`).
     const { SoapClient } = createRequire(${JSON.stringify(pathToFileURL(CLI).href)})('@arcasdk/core');
     SoapClient.prototype.createClient = async () => { throw new Error('sin ARCA'); };
     const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => stdin, ref() {}, unref() {} });
     Object.defineProperty(process, 'stdin', { value: stdin });
     Object.assign(process.stdout, { columns: 120, isTTY: true, rows: 60 });
     const answers = ${JSON.stringify(answers)};
     let text = '';
     const write = process.stdout.write.bind(process.stdout);
     process.stdout.write = (chunk, ...rest) => {
       text += stripVTControlCharacters(String(chunk));
       if (answers.length > 0 && text.includes(answers[0][0])) {
         const [, keys] = answers.shift();
         text = '';
         setTimeout(() => stdin.write(keys), 100);
       }
       return write(chunk, ...rest);
     };
     // Como una terminal: mientras se lee, el proceso sigue. Una pregunta que nadie contesta en 10 s sale con 71.
     const waiting = setTimeout(() => process.exit(71), 10000).unref();
     stdin.on('resume', () => waiting.refresh().ref()).on('pause', () => waiting.unref());`,
  );
}

/** WSFEX entero, y el numero autorizado en `emitidos.txt`. */
function fakeWsfex(): string {
  const gateway = pathToFileURL(resolve('dist/services/arca/arca-export.gateway.js')).href;

  return writePreload(
    'wsfex.mjs',
    `import { appendFileSync } from 'node:fs';
     import { ArcaExportGateway } from ${JSON.stringify(gateway)};
     const answers = {
       getActivities: [{ id: 620100, name: 'SERVICIOS' }],
       getCurrencies: [{ code: 'DOL', name: 'Dolar' }],
       getDestinationCountries: [{ code: 212, name: 'ESTADOS UNIDOS' }],
       getDestinationCountryCuits: [{ countryName: 'ESTADOS UNIDOS - Persona Juridica', cuit: 55000002126 }],
       getIncoterms: [], getLanguages: [{ id: 1, name: 'Espanol' }], getLastRequestId: 7, getLastVoucherNumber: 8,
       getQuotations: [], getUnits: [{ id: 7, name: 'unidades' }],
     };
     for (const [name, answer] of Object.entries(answers)) ArcaExportGateway.prototype[name] = async () => answer;
     const { authorize } = ArcaExportGateway.prototype;
     const read = (answer) => authorize.call(new ArcaExportGateway({ wsfexService: { authorize: async () => answer } }));
     ArcaExportGateway.prototype.authorize = async (payload) => {
       appendFileSync(${JSON.stringify(file('emitidos.txt'))}, payload.Cbte_nro + '\\n');
       return read({ FEXAuthorizeResult: { FEXErr: { ErrCode: 0, ErrMsg: '' }, FEXEvents: { EventCode: 0, EventMsg: '' },
         FEXResultAuth: { Cae: '75123456789012', Cbte_nro: payload.Cbte_nro, Fch_venc_Cae: '20991231', Id: payload.Id,
           Motivos_Obs: '', Punto_vta: payload.Punto_vta, Reproceso: 'N', Resultado: 'A' } } });
     };`,
  );
}

/** El texto de los paneles, sin bordes ni cortes de linea. */
function plain(text: string): string {
  return text.replace(/[│┃║╏╎┊▎\s]+/g, ' ');
}

const INVOICE = ['fc', '-m', '1000', '--cs', '--cfinal', '--emitir'];
const EXPORT_INVOICE = [
  ...['fe', '-m', '1500', '--cm', '1000', '--cliente', 'ACME LLC', '--domicilio-cliente', '123 Main St'],
  ...['--pais-destino', '212', '--cuit-pais', '55000002126', '--emitir'],
];

beforeAll(() => {
  if (!existsSync(CLI)) {
    throw new Error('No está dist/cli/index.js: corré `yarn build` antes de `yarn test:e2e`.');
  }

  [EXPIRING_DAYS, HEALTHY_DAYS].forEach(createSelfSignedCertificate);
}, OPENSSL_WARM_UP_TIMEOUT_MS);

afterAll(removeSelfSignedCertificates);

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'arcli-closed-output-'));
});

afterEach(() => {
  rmSync(directory, { force: true, recursive: true });
});

describe('con stdout cerrado', () => {
  it.each([
    [['ayuda']],
    [['fc', '--ayuda']],
    [['ejemplos']],
    [['config', 'revisar', '--json']],
    [['completado', 'bash']],
  ])('%j sale con 0 y sin nada en stderr', async (args) => {
    expect(await runClosing(['stdout'], args)).toEqual({ code: 0, stderr: '', stdout: '' });
  });

  it('un lote que falla a la mitad: PDF de los emitidos, su error en stderr y exit 1', async () => {
    configure({ pdf: 'siempre' });
    fakePdfPlugin();
    writeBatch();

    const result = await runClosing(
      ['stdout'],
      ['fc', '--cargar', file('lote.json'), '--emitir'],
      [fakeArca({ failsAt: 43 })],
    );

    expect(emitted()).toEqual(['42']);
    expect(pdfs()).toHaveLength(1);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('El lote se interrumpió en el comprobante #2');
    expect(result.stderr).toContain('Procesados: 1 de 3');
    expect(result.stderr).not.toMatch(/write E|node:/);
  });

  it('un comprobante rechazado por ARCA sale con 2', async () => {
    configure();

    expect(await runClosing(['stdout'], INVOICE, [fakeArca({ result: 'R' })])).toEqual({
      code: 2,
      stderr: '',
      stdout: '',
    });
  });

  it('lo que sigue a la escritura se completa: el comprobante emitido tiene su PDF', async () => {
    configure({ pdf: 'siempre' });
    fakePdfPlugin();

    const result = await runClosing(['stdout'], INVOICE, [fakeArca()]);

    expect(emitted()).toEqual(['42']);
    expect(pdfs()).toHaveLength(1);
    expect(result).toEqual({ code: 0, stderr: '', stdout: '' });
  });
});

describe('con stderr cerrado', () => {
  it('un aviso no corta: el comando escribe en stdout y sale con 0', async () => {
    const result = await runClosing(['stderr'], ['config', 'revisar', '--json', '--bruto']);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false });
  });

  it('un rechazado sale con 2 aunque no se pueda escribir el aviso del certificado, que va antes', async () => {
    configure({ days: EXPIRING_DAYS });

    const result = await runClosing(['stderr'], [...INVOICE, '--json'], [fakeArca({ result: 'R' })]);

    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ estado: 'rechazado' });
  });

  it('un lote se emite entero aunque no se pueda escribir el aviso del certificado, que va antes', async () => {
    configure({ days: EXPIRING_DAYS });
    writeBatch();

    const result = await runClosing(
      ['stderr'],
      ['fc', '--cargar', file('lote.json'), '--emitir', '--json'],
      [fakeArca()],
    );

    expect(emitted()).toEqual(['42', '43', '44']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toHaveLength(3);
  });
});

describe('con las dos salidas cerradas', () => {
  it('la emisión y el PDF terminan, con el código del comando', async () => {
    configure({ days: EXPIRING_DAYS, pdf: 'siempre' });
    fakePdfPlugin();

    const result = await runClosing(['stdout', 'stderr'], INVOICE, [fakeArca()]);

    expect(emitted()).toEqual(['42']);
    expect(pdfs()).toHaveLength(1);
    expect(result.code).toBe(0);
  });
});

/**
 * ERR-18: la salida no se puede escribir (disco lleno). El trabajo termina igual y lo que se emitio se dice por la otra
 * salida. Con las dos rotas solo queda el codigo.
 */
describe('con stdout que no se puede escribir', () => {
  const UNWRITTEN = 'No se pudo escribir toda la salida: no queda espacio en el disco.';
  const UNCONFIRMED =
    'Los procesados con CAE ya se emitieron: recordá no volver a cargarlos. Verificá el #2 antes de reintentarlo. Después reintentá únicamente los que quedaron sin procesar.';
  const SINGLE =
    'Se emitió: fc del punto de venta 3, 42. Verificalo con `arcli ultimos fc --pv 3 --cantidad 2 --testing`.';

  /** Corre y controla lo de todos los casos: sin stack y con el motivo una sola vez. */
  async function runFailing(args: readonly string[], preloads: readonly string[] = [], code?: string): Promise<Run> {
    const result = await runClosing([], args, [failOutput(['stdout'], { code }), ...preloads]);

    expect(result.stdout).toBe('');
    expect(result.stderr).not.toMatch(/write E|node:|Unhandled|\bat /);
    expect(result.stderr.match(/No se pudo escribir/g)).toHaveLength(1);

    return { ...result, stderr: plain(result.stderr) };
  }

  it.each([[['ayuda']], [['fc', '--ayuda']], [['config', 'revisar']], [['completado', 'bash']]])(
    '%j sale con 1 y dice por qué, sin hablar de emisiones',
    async (args) => {
      const result = await runFailing(args);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(UNWRITTEN);
      expect(result.stderr).not.toMatch(/emiti[óe]/);
    },
  );

  it('otro código sale tal cual', async () => {
    const result = await runFailing(['ayuda'], [], 'EIO');

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('No se pudo escribir toda la salida: EIO.');
  });

  it('un comprobante: qué se emitió y con qué verlo', async () => {
    configure();

    const result = await runFailing(INVOICE, [fakeArca()]);

    expect(emitted()).toEqual(['42']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(UNWRITTEN);
    expect(result.stderr).toContain(SINGLE);
  });

  it('el PDF, que va después de escribir, se guarda', async () => {
    configure({ pdf: 'siempre' });
    fakePdfPlugin();

    const result = await runFailing(INVOICE, [fakeArca()]);

    expect(emitted()).toEqual(['42']);
    expect(pdfs()).toHaveLength(1);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(SINGLE);
  });

  it('un lote se emite entero, con sus PDF', async () => {
    configure({ pdf: 'siempre' });
    fakePdfPlugin();
    writeBatch();

    const result = await runFailing(['fc', '--cargar', file('lote.json'), '--emitir'], [fakeArca()]);

    expect(emitted()).toEqual(['42', '43', '44']);
    expect(pdfs()).toHaveLength(3);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'Se emitieron: fc del punto de venta 3, del 42 al 44. Verificalos con `arcli ultimos fc --pv 3 --cantidad 4 --testing`.',
    );
  });

  it('un lote cortado: su error y los que ya se emitieron', async () => {
    configure();
    writeBatch();

    const result = await runFailing(['fc', '--cargar', file('lote.json'), '--emitir'], [fakeArca({ failsAt: 44 })]);

    expect(emitted()).toEqual(['42', '43']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('El lote se interrumpió en el comprobante #3');
    expect(result.stderr).toContain(
      'Se emitieron: fc del punto de venta 3, 42 y 43. Verificalos con `arcli ultimos fc --pv 3 --cantidad 3 --testing`.',
    );
  });

  it('la E', async () => {
    configure({ pdf: 'siempre' });
    fakePdfPlugin();

    const result = await runFailing(EXPORT_INVOICE, [fakeWsfex()]);

    expect(emitted()).toEqual(['9']);
    expect(pdfs()).toHaveLength(1);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'Se emitió: fe del punto de venta 3, 9. Verificalo con `arcli ultimos fe --pv 3 --cantidad 2 --testing`.',
    );
  });

  it('con --json, un error con la forma de siempre y lo emitido en `sugerencia`', async () => {
    configure();

    const result = await runFailing([...INVOICE, '--json'], [fakeArca()]);

    expect(emitted()).toEqual(['42']);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      codigo: 'OUTPUT_WRITE_ERROR',
      detalles: null,
      error: UNWRITTEN,
      sugerencia: SINGLE,
    });
  });

  it('con --json y sin emitir, sin sugerencia', async () => {
    const result = await runFailing(['config', 'revisar', '--json']);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      codigo: 'OUTPUT_WRITE_ERROR',
      detalles: null,
      error: UNWRITTEN,
      sugerencia: null,
    });
  });

  it('con --json, la ayuda (que commander corta como un error) también lo dice', async () => {
    const result = await runFailing(['fc', '--ayuda', '--json']);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ codigo: 'OUTPUT_WRITE_ERROR', error: UNWRITTEN });
  });

  it('con --json y un lote cortado, stderr sigue siendo un solo JSON: el error del lote', async () => {
    configure();
    writeBatch();

    const result = await runFailing(
      ['fc', '--cargar', file('lote.json'), '--emitir', '--json'],
      [fakeArca({ failsAt: 43 })],
    );

    expect(emitted()).toEqual(['42']);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      codigo: 'BATCH_EMISSION_ERROR',
      detalles: { fallo: 2, numero: 43, procesados: 1, sinConfirmar: 2, sinProcesar: [3], total: 3 },
      sugerencia: `${UNCONFIRMED} ${UNWRITTEN} ${SINGLE}`,
    });
  });

  it('con --json, un error que llega tarde entra en el mismo JSON', async () => {
    configure();
    writeBatch();

    const result = await runClosing(
      [],
      ['fc', '--cargar', file('lote.json'), '--emitir', '--json'],
      [failOutput(['stdout'], { delayMs: 300 }), fakeArca({ failsAt: 43 })],
    );

    expect(JSON.parse(result.stderr)).toMatchObject({
      codigo: 'BATCH_EMISSION_ERROR',
      sugerencia: `${UNCONFIRMED} ${UNWRITTEN} ${SINGLE}`,
    });
  });

  it('con --json, una escritura que no termina no demora el error: hay un tope', async () => {
    configure();
    writeBatch();

    const result = await runClosing(
      [],
      ['fc', '--cargar', file('lote.json'), '--emitir', '--json'],
      [failOutput(['stdout'], { delayMs: 4000 }), fakeArca({ failsAt: 43 })],
    );

    // El error del lote sale en el tope; el aviso, recien cuando se sabe, aparte.
    expect(result.stderr.indexOf('BATCH_EMISSION_ERROR')).toBeGreaterThan(-1);
    expect(result.stderr.indexOf('BATCH_EMISSION_ERROR')).toBeLessThan(result.stderr.indexOf('No se pudo escribir'));
    expect(plain(result.stderr)).toContain(SINGLE);
  });

  it('con `json=true` en la config, el aviso de actualización no va con el JSON', async () => {
    configure();
    writeFileSync(file('config.json'), JSON.stringify({ ...readConfig(), output: { jsonPorDefecto: true } }));
    writeFileSync(file('update-cache.json'), JSON.stringify({ lastCheckedAt: Date.now(), latestVersion: '99.0.0' }));

    const terminal = writePreload(
      'terminal.mjs',
      `delete process.env.CI; delete process.env.NO_UPDATE_NOTIFIER; process.stderr.isTTY = true;`,
    );
    const healthy = await runClosing([], INVOICE, [terminal, fakeArca()]);
    const result = await runClosing([], INVOICE, [failOutput(['stdout'], { delayMs: 100 }), terminal, fakeArca()]);

    expect(healthy.stderr).toContain('99.0.0');
    expect(JSON.parse(stripVTControlCharacters(result.stderr))).toMatchObject({ error: UNWRITTEN });

    const asText = await runClosing([], ['ayuda'], [failOutput(['stdout']), terminal]);

    writeFileSync(file('config.json'), JSON.stringify({ ...readConfig(), output: { jsonPorDefecto: false } }));

    const inText = await runClosing([], INVOICE, [failOutput(['stdout']), terminal, fakeArca()]);

    expect(asText.stderr).not.toContain('99.0.0');
    expect(inText.stderr).toContain('99.0.0');
    expect(plain(inText.stderr)).toContain(UNWRITTEN);
  });

  it('un rechazo sale con 2 y no dice que se emitió', async () => {
    configure();

    const result = await runFailing(INVOICE, [fakeArca({ result: 'R' })]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(UNWRITTEN);
    expect(result.stderr).not.toMatch(/emiti[óe]/);
  });

  it('una vista previa no dice que se emitió', async () => {
    configure();

    const result = await runFailing(['fc', '-m', '1000', '--cs', '--cfinal', '--previsualizar'], [fakeArca()]);

    expect(emitted()).toEqual([]);
    expect(result.code).toBe(1);
    expect(result.stderr).not.toMatch(/emiti[óe]/);
  });

  it.skipIf(!existsSync('/dev/full'))('con el disco lleno de verdad (/dev/full)', () => {
    const full = openSync('/dev/full', 'w');
    const result = spawnSync(process.execPath, [CLI, 'ayuda'], {
      encoding: 'utf8',
      env: { ...process.env, ARCLI_CONFIG_DIR: directory, FORCE_COLOR: '0', HOME: directory, NO_UPDATE_NOTIFIER: '1' },
      stdio: ['ignore', full, 'pipe'],
    });

    closeSync(full);

    expect(result.status).toBe(1);
    expect(plain(result.stderr)).toContain(UNWRITTEN);
    expect(result.stderr).not.toMatch(/write E|node:/);
  });
});

describe('con stderr que no se puede escribir', () => {
  const UNWRITTEN = 'No se pudieron escribir todos los avisos y errores: no queda espacio en el disco.';

  it('un comprobante: sale entero y, después, el aviso con lo emitido', async () => {
    configure({ days: EXPIRING_DAYS, pdf: 'siempre' });
    fakePdfPlugin();

    const result = await runClosing([], INVOICE, [failOutput(['stderr']), fakeArca()]);
    const stdout = plain(result.stdout);

    expect(emitted()).toEqual(['42']);
    expect(pdfs()).toHaveLength(1);
    expect(result.code).toBe(1);
    expect(stdout).toContain('75123456789012');
    expect(stdout).toContain(UNWRITTEN);
    expect(stdout).toContain('Se emitió: fc del punto de venta 3, 42.');
  });

  it('un lote completo: salen los tres y el aviso', async () => {
    configure({ days: EXPIRING_DAYS, pdf: 'siempre' });
    fakePdfPlugin();
    writeBatch();

    const result = await runClosing(
      [],
      ['fc', '--cargar', file('lote.json'), '--emitir'],
      [failOutput(['stderr']), fakeArca()],
    );

    expect(emitted()).toEqual(['42', '43', '44']);
    expect(pdfs()).toHaveLength(3);
    expect(result.code).toBe(1);
    expect(plain(result.stdout)).toContain('Lote 3/3');
    expect(plain(result.stdout)).toContain('Se emitieron: fc del punto de venta 3, del 42 al 44.');
  });

  it('la E', async () => {
    configure({ days: EXPIRING_DAYS, pdf: 'siempre' });
    fakePdfPlugin();

    const result = await runClosing([], EXPORT_INVOICE, [failOutput(['stderr']), fakeWsfex()]);

    expect(emitted()).toEqual(['9']);
    expect(pdfs()).toHaveLength(1);
    expect(result.code).toBe(1);
    expect(plain(result.stdout)).toContain('Se emitió: fe del punto de venta 3, 9.');
  });

  it('una vista previa no dice que se emitió', async () => {
    configure({ days: EXPIRING_DAYS });

    const result = await runClosing(
      [],
      ['fc', '-m', '1000', '--cs', '--cfinal', '--previsualizar'],
      [failOutput(['stderr']), fakeArca()],
    );

    expect(emitted()).toEqual([]);
    expect(result.code).toBe(1);
    expect(plain(result.stdout)).toContain(UNWRITTEN);
    expect(plain(result.stdout)).not.toMatch(/Se emiti/);
  });

  it('un lote cortado: los emitidos y el error del lote, que no se pudo escribir', async () => {
    configure();
    writeBatch();

    const result = await runClosing(
      [],
      ['fc', '--cargar', file('lote.json'), '--emitir'],
      [failOutput(['stderr']), fakeArca({ failsAt: 43 })],
    );
    const stdout = plain(result.stdout);

    expect(emitted()).toEqual(['42']);
    expect(result.code).toBe(1);
    expect(stdout).toContain(UNWRITTEN);
    expect(stdout).toContain('Se emitió: fc del punto de venta 3, 42.');
    expect(stdout).toContain('El lote se interrumpió en el comprobante #2');
    expect(stdout).toContain('arcli ultimos fc --pv 3 --testing');
  });

  it('una emisión sin confirmar no se pierde', async () => {
    configure();

    const result = await runClosing([], INVOICE, [failOutput(['stderr']), fakeArca({ failsAt: 42 })]);

    expect(result.code).toBe(1);
    expect(plain(result.stdout)).toContain('No se pudo confirmar la emisión');
    expect(plain(result.stdout)).not.toContain('Se emitió:');
  });

  it('con --json stdout sigue siendo solo el JSON del resultado', async () => {
    configure({ days: EXPIRING_DAYS });

    const result = await runClosing([], [...INVOICE, '--json'], [failOutput(['stderr']), fakeArca()]);

    expect(emitted()).toEqual(['42']);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ cae: '75123456789012' });
  });

  it('un rechazo sigue saliendo con 2', async () => {
    configure({ days: EXPIRING_DAYS });

    const result = await runClosing([], [...INVOICE, '--json'], [failOutput(['stderr']), fakeArca({ result: 'R' })]);

    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ estado: 'rechazado' });
  });

  it('sin nada que escribir en stderr, no cambia nada', async () => {
    const result = await runClosing([], ['ayuda'], [failOutput(['stderr'])]);

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('No se pud');
  });
});

describe('con las dos salidas que no se pueden escribir', () => {
  it('se emite lo mismo y sale con 1', async () => {
    configure({ days: EXPIRING_DAYS, pdf: 'siempre' });
    fakePdfPlugin();

    const result = await runClosing([], INVOICE, [failOutput(['stdout', 'stderr']), fakeArca()]);

    expect(emitted()).toEqual(['42']);
    expect(pdfs()).toHaveLength(1);
    expect(result).toEqual({ code: 1, stderr: '', stdout: '' });
  });

  it('si recién falla el aviso, también', async () => {
    const result = await runClosing([], ['ayuda'], [failOutput(['stdout', 'stderr'])]);

    expect(result).toEqual({ code: 1, stderr: '', stdout: '' });
  });

  it('una rota y la otra cortada: el aviso se pierde y sale con 1', async () => {
    configure();

    const result = await runClosing(['stderr'], INVOICE, [failOutput(['stdout']), fakeArca()]);

    expect(emitted()).toEqual(['42']);
    expect(result.code).toBe(1);
  });
});

const ENTER = '\r';
/** Factura C, $ 1.000, servicios, consumidor final: hasta "¿Emitimos?". */
const ASSISTANT_INVOICE: ReadonlyArray<readonly [string, string]> = [
  ['¿Qué querés hacer?', ENTER],
  ['¿Qué comprobante querés emitir?', `factura c${ENTER}`],
  ['¿A quién le facturás?', `consumidor${ENTER}`],
  ['¿Qué estás facturando?', `servicios${ENTER}`],
  ['Monto total:', `1000${ENTER}`],
  ['opcional', ENTER],
  ['Emitimos', ENTER],
];

describe('el asistente', () => {
  it('con stdout roto desde el principio no pregunta: termina con 1', async () => {
    configure();

    const result = await runClosing(
      [],
      ['interactivo'],
      [failOutput(['stdout']), driveAssistant(ASSISTANT_INVOICE), fakeArca()],
    );

    expect(emitted()).toEqual([]);
    expect(result.code).toBe(1);
    expect(plain(result.stderr)).toContain('No se pudo escribir toda la salida: no queda espacio en el disco.');
  });

  it('con stdout cortado (EPIPE), lo mismo', async () => {
    configure();

    const result = await runClosing(
      [],
      ['interactivo'],
      [failOutput(['stdout'], { code: 'EPIPE' }), driveAssistant(ASSISTANT_INVOICE), fakeArca()],
    );

    expect(result.code).toBe(1);
    expect(plain(result.stderr)).toContain('No se pudo escribir toda la salida: EPIPE.');
  });

  it('si stdout se rompe al mostrar "¿Emitimos?", no emite', async () => {
    configure();

    const result = await runClosing(
      [],
      ['interactivo'],
      [failOutput(['stdout'], { when: "seen.includes('Emitimos')" }), driveAssistant(ASSISTANT_INVOICE), fakeArca()],
    );

    expect(result.stdout).toContain('SIN EMITIR');
    expect(emitted()).toEqual([]);
    expect(result.code).toBe(1);
    expect(plain(result.stderr)).not.toContain('Se emitió');
  });

  it('si se rompe después de emitir, dice qué se emitió y no sigue preguntando', async () => {
    configure();

    const result = await runClosing(
      [],
      ['interactivo'],
      [
        failOutput(['stdout'], { when: `existsSync(${JSON.stringify(file('emitidos.txt'))})` }),
        driveAssistant([...ASSISTANT_INVOICE, ...ASSISTANT_INVOICE]),
        fakeArca(),
      ],
    );

    expect(emitted()).toEqual(['42']);
    expect(result.code).toBe(1);
    expect(plain(result.stderr)).toContain('Se emitió: fc del punto de venta 3, 42.');
  });

  it.each([0, 200])(
    'con stderr roto (el error llega a los %i ms), una emisión sin confirmar se ve en stdout antes de volver al menú',
    async (delayMs) => {
      configure();

      const result = await runClosing(
        [],
        ['interactivo'],
        [
          // Es el primer error de stderr: nadie supo antes que estaba rota.
          failOutput(['stderr'], { delayMs, when: "seen.includes('No se pudo confirmar')" }),
          driveAssistant([...ASSISTANT_INVOICE, ['¿Qué querés hacer?', '\x1b']]),
          fakeArca({ failsAt: 42 }),
        ],
      );
      const stdout = plain(result.stdout);

      expect(result.code).toBe(1);
      expect(stdout.match(/No se pudo confirmar la emisión/g)).toHaveLength(1);
      expect(stdout.indexOf('No se pudo confirmar')).toBeLessThan(stdout.lastIndexOf('¿Qué querés hacer?'));
    },
  );
});

describe('el asistente con `json=true` en la config: no tiene salida JSON', () => {
  function configureJson(): void {
    configure();
    writeFileSync(file('config.json'), JSON.stringify({ ...readConfig(), output: { jsonPorDefecto: true } }));
  }

  it('con stderr roto, el aviso va en texto por stdout', async () => {
    configureJson();

    const result = await runClosing(
      [],
      ['interactivo'],
      [
        failOutput(['stderr'], { when: "seen.includes('No se pudo confirmar')" }),
        driveAssistant([...ASSISTANT_INVOICE, ['¿Qué querés hacer?', '\x1b']]),
        fakeArca({ failsAt: 42 }),
      ],
    );

    expect(result.code).toBe(1);
    expect(plain(result.stdout)).toContain('No se pudo confirmar la emisión');
    expect(plain(result.stdout)).toContain('No se pudieron escribir todos los avisos y errores: no queda espacio');
  });

  it('con stdout roto y una emisión sin confirmar, el error y el aviso van en texto por stderr', async () => {
    configureJson();

    const result = await runClosing(
      [],
      ['interactivo'],
      [
        failOutput(['stdout'], { when: `existsSync(${JSON.stringify(file('enviado.txt'))})` }),
        driveAssistant(ASSISTANT_INVOICE),
        fakeArca({ failsAt: 42 }),
      ],
    );

    expect(result.code).toBe(1);
    expect(plain(result.stderr)).toContain('No se pudo confirmar la emisión');
    expect(plain(result.stderr)).toContain('No se pudo escribir toda la salida: no queda espacio en el disco.');
    expect(result.stderr).not.toContain('"codigo"');
  });

  it('con --json explícito, el aviso va en JSON, como los errores de hoy', async () => {
    configure();

    const result = await runClosing(
      [],
      ['interactivo', '--json'],
      [failOutput(['stdout']), driveAssistant(ASSISTANT_INVOICE), fakeArca()],
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('"codigo": "OUTPUT_WRITE_ERROR"');
  });

  it('sin terminal no se abre: ese error sigue en JSON', async () => {
    configureJson();

    const result = await runClosing([], ['interactivo']);

    expect(JSON.parse(result.stderr)).toMatchObject({ codigo: 'INPUT_VALIDATION_ERROR' });
  });
});

describe('el asistente con el PDF elegido, si stdout se rompe después de emitir', () => {
  it('no lo genera sin preguntar los datos y el aviso lo dice', async () => {
    configure({ pdf: 'siempre' });
    fakePdfPlugin();

    const result = await runClosing(
      [],
      ['interactivo'],
      [
        failOutput(['stdout'], { when: `existsSync(${JSON.stringify(file('emitidos.txt'))})` }),
        driveAssistant(ASSISTANT_INVOICE),
        fakeArca(),
      ],
    );

    expect(emitted()).toEqual(['42']);
    expect(pdfs()).toEqual([]);
    expect(result.code).toBe(1);
    expect(plain(result.stderr)).toContain('Se emitió: fc del punto de venta 3, 42.');
    expect(plain(result.stderr)).toContain('No se generó el PDF: fc del punto de venta 3, 42.');
  });
});

// Cada preload se traga el error, como podria hacer el CLI: el intento igual tiene que hacer fallar el test.
describe('el bloqueo de red de estos tests', () => {
  it.each([
    ['fetch', 'connect', `await fetch('http://127.0.0.1:59999').catch(() => {});`],
    [
      'https',
      'connect',
      `import https from 'node:https'; try { https.get('https://127.0.0.1:9').on('error', () => {}); } catch {}`,
    ],
    ['net', 'connect', `import { connect } from 'node:net'; try { connect(9, '127.0.0.1'); } catch {}`],
    ['dns', 'lookup', `import { lookup } from 'node:dns'; try { lookup('arca.invalid', () => {}); } catch {}`],
    [
      'dns/promises',
      'resolve4',
      `import { resolve4 } from 'node:dns/promises'; try { await resolve4('arca.invalid'); } catch {}`,
    ],
  ])('%s: el intento hace fallar el test', async (name, blocked, source) => {
    const attempt = writePreload('intento.mjs', source);

    await expect(runClosing([], ['--version'], [attempt]), name).rejects.toThrow(`Intentó usar la red: ${blocked}`);
  });
});
