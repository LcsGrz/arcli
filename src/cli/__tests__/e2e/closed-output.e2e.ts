import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
 * que no depende de la velocidad de nadie. Sin red: donde se emite, otro preload reemplaza la llamada a ARCA.
 *
 * No se afirma el codigo con el que cada sistema avisa el cierre: si alguno usa otro que EPIPE, stderr lo muestra y
 * el test falla con ese texto. El CI los corre en Linux, macOS y Windows.
 */
const CLI = resolve('dist/cli/index.js');
const CUIT = '20409509763';
const HEALTHY_DAYS = 365;
const EXPIRING_DAYS = 10;
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

async function runClosing(
  closed: readonly OutputName[],
  args: readonly string[],
  preloads: readonly string[] = [],
): Promise<Run> {
  const gate = writePreload(
    'gate.mjs',
    `import { existsSync } from 'node:fs';
     const cell = new Int32Array(new SharedArrayBuffer(4));
     while (!existsSync(${JSON.stringify(file('cerrado'))})) Atomics.wait(cell, 0, 0, 10);`,
  );
  const child = spawn(
    process.execPath,
    [...[gate, ...preloads].flatMap((preload) => ['--import', preload]), CLI, ...args],
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

  return { code, ...read };
}

/** Reemplaza las dos llamadas a WSFE de la emision y anota cada comprobante en `emitidos.txt`. */
function fakeArca(result: 'A' | 'R' = 'A'): string {
  const gateway = pathToFileURL(resolve('dist/services/arca/arca-billing.gateway.js')).href;

  return writePreload(
    'arca.mjs',
    `import { appendFileSync } from 'node:fs';
     import { setTimeout } from 'node:timers/promises';
     import { ArcaBillingGateway } from ${JSON.stringify(gateway)};
     let number = 41;
     ArcaBillingGateway.prototype.getNextVoucherNumber = async () => { await setTimeout(50); return number + 1; };
     ArcaBillingGateway.prototype.createVoucher = async () => {
       await setTimeout(50);
       number += 1;
       appendFileSync(${JSON.stringify(file('emitidos.txt'))}, number + '\\n');
       return {
         cae: ${JSON.stringify(result === 'A' ? '75123456789012' : '')},
         caeFchVto: ${JSON.stringify(result === 'A' ? '20991231' : '')},
         response: { FeDetResp: { FECAEDetResponse: [
           { CbteDesde: number, CbteHasta: number, Resultado: ${JSON.stringify(result)} },
         ] } },
       };
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

function emitted(): string[] {
  return existsSync(file('emitidos.txt')) ? readFileSync(file('emitidos.txt'), 'utf8').trim().split('\n') : [];
}

function pdfs(): string[] {
  const folder = join(directory, 'pdfs', 'testing', CUIT);

  return existsSync(folder) ? readdirSync(folder) : [];
}

const INVOICE = ['fc', '-m', '1000', '--cs', '--cfinal', '--emitir'];

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

  it('un comando que falla muestra su error y sale con 1', async () => {
    const result = await runClosing(['stdout'], ['noexiste', '--json']);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ codigo: 'INPUT_VALIDATION_ERROR' });
  });

  it('un comprobante rechazado por ARCA sale con 2', async () => {
    configure();

    expect(await runClosing(['stdout'], INVOICE, [fakeArca('R')])).toEqual({ code: 2, stderr: '', stdout: '' });
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

  it('un comando que falla sale con 1', async () => {
    expect(await runClosing(['stderr'], ['noexiste'])).toEqual({ code: 1, stderr: '', stdout: '' });
  });

  it('un lote se emite entero aunque no se pueda escribir el aviso del certificado, que va antes', async () => {
    const item = {
      concepto: 'servicios',
      ivaReceptor: 'consumidor-final',
      montoTotal: 1000,
      tipoDocumento: 'consumidor-final',
    };

    configure({ days: EXPIRING_DAYS });
    writeFileSync(file('lote.json'), JSON.stringify([item, item, item]));

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
