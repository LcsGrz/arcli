import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import forge from 'node-forge';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ERROR_CODES } from '../../lib/errors/error-codes';
import type { OutputFailures } from '../closed-output';
import { reportCliError, reportOutputFailure, shouldPrintErrorAsJson } from '../error-output';
import { createProgram } from '../program';

/**
 * `arcli constatar` (SDK-10): constata en WSCDC un comprobante que emitió otro. El comando entero, como lo corre
 * `index.ts`, con la config en una carpeta temporal, WSAA falso y WSCDC falso a nivel HTTP: node-soap arma el pedido
 * con el WSDL que pasa el comando y estos tests leen el XML que le llegaría a ARCA y contestan como ARCA.
 *
 * El HTTP se cambia en `SoapClient.createClient` de `@arcasdk/core` (el mismo que usa `cancellable-dummy.ts`), y el
 * login en `AuthRepository.login`: el comando tiene que pedir el ticket de `wscdc` y armar el cliente con ellos.
 *
 * Tests primero (SDK-10): pasa cada `it.fails` a `it` al implementarlo. Lo que falta del contrato (los golden de
 * json-golden.test.ts, public-contract.txt y docs) lo suma quien implementa.
 */

const originalTimeZone = process.env.TZ;

process.env.TZ = 'America/Argentina/Buenos_Aires';

afterAll(() => {
  if (originalTimeZone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimeZone;
  }
});

/** 17/11/2026 al mediodía de Buenos Aires. */
const NOW = new Date('2026-11-17T15:00:00Z');
/** Quien consulta: el CUIT de la config. */
const CUIT = '20111111112';
/** Quien emitió el comprobante que se constata. */
const ISSUER = '30709965812';
const CAE = '76463926585341';

const WSDL_URL = {
  produccion: 'https://servicios1.afip.gov.ar/WSCDC/service.asmx',
  testing: 'https://wswhomo.afip.gov.ar/WSCDC/service.asmx',
};

interface SoapRequest {
  readonly url: string;
  readonly xml: string;
}

/** WSAA y WSCDC falsos: cada test cambia lo que contesta WSCDC con `wscdc.answer`. */
const fake = vi.hoisted(() => ({
  answer: { current: (_xml: string): string | Error => '' },
  login: vi.fn<(service: string) => Promise<object>>(),
  requests: [] as SoapRequest[],
}));

const WSAA = vi.hoisted(() => ({ sign: 'FIRMA-DE-WSAA', token: 'TOKEN-DE-WSAA' }));

vi.mock('@arcasdk/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@arcasdk/core')>();

  type Options = NonNullable<Parameters<InstanceType<typeof original.SoapClient>['createClient']>[1]>;
  /** El cliente de node-soap, sin depender de `soap` directamente. */
  type Client = Parameters<InstanceType<typeof original.SoapClient>['setEndpoint']>[0];

  const httpClient = {
    request: (url: string, xml: string, callback: (error: Error | null, response?: object, body?: string) => void) => {
      fake.requests.push({ url, xml });

      const body = fake.answer.current(xml);

      if (body instanceof Error) {
        callback(body);
      } else {
        callback(null, { data: body, headers: {}, status: 200, statusCode: 200 }, body);
      }

      return {};
    },
  };

  class SoapClient extends original.SoapClient {
    public override createClient<T extends Client>(wsdl: string, options: Options = {}): Promise<T> {
      return super.createClient<T>(wsdl, { ...options, httpClient: httpClient as unknown as Options['httpClient'] });
    }
  }

  return {
    ...original,
    AuthRepository: class {
      public getAuthParams(_ticket: unknown, cuit: number) {
        return { Auth: { Cuit: cuit, Sign: WSAA.sign, Token: WSAA.token } };
      }

      public async login(service: string) {
        return fake.login(service);
      }
    },
    SoapClient,
  };
});

// ---------------------------------------------------------------------------------------------------------------
// Lo que llega a WSCDC y lo que contesta.
// ---------------------------------------------------------------------------------------------------------------

/** El valor de un campo del XML, con o sin prefijo de namespace; `undefined` si no está. */
function field(xml: string, name: string): string | undefined {
  return new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:[\\w-]+:)?${name}>`).exec(xml)?.[1];
}

function hasElement(xml: string, name: string): boolean {
  return new RegExp(`<(?:[\\w-]+:)?${name}[\\s/>]`).test(xml);
}

/** El pedido de constatación, el único que tiene que llegar a WSCDC. */
function constatarRequest(): SoapRequest {
  const requests = fake.requests.filter(({ xml }) => hasElement(xml, 'ComprobanteConstatar'));

  expect(requests, 'un solo ComprobanteConstatar').toHaveLength(1);

  return requests[0]!;
}

const CMP_FIELDS = [
  'CbteModo',
  'CuitEmisor',
  'PtoVta',
  'CbteTipo',
  'CbteNro',
  'CbteFch',
  'ImpTotal',
  'CodAutorizacion',
  'DocTipoReceptor',
  'DocNroReceptor',
] as const;

/** Los campos de `CmpReq` que llegaron, para comparar de una. */
function sentVoucher(): Partial<Record<(typeof CMP_FIELDS)[number], string>> {
  const { xml } = constatarRequest();

  return Object.fromEntries(
    CMP_FIELDS.map((name) => [name, field(xml, name)]).filter(([, value]) => value !== undefined),
  ) as Partial<Record<(typeof CMP_FIELDS)[number], string>>;
}

type Messages = ReadonlyArray<readonly [code: number, message: string]>;

function list(container: string, item: string, messages: Messages | undefined): string {
  return messages
    ? `<${container}>${messages.map(([code, msg]) => `<${item}><Code>${code}</Code><Msg>${msg}</Msg></${item}>`).join('')}</${container}>`
    : '';
}

/** La respuesta de `ComprobanteConstatar`: el eco de lo pedido (`CmpResp`) y lo que se pida. */
function answer(
  options: {
    readonly errors?: Messages;
    readonly events?: Messages;
    readonly observations?: Messages;
    /** Sin definir: sin `Resultado` ni `FchProceso`, como en los errores de infraestructura y de autenticación. */
    readonly result?: 'A' | 'R';
  } = { result: 'A' },
) {
  return (xml: string): string => {
    const echo = CMP_FIELDS.map((name) => {
      const value = field(xml, name);

      return value === undefined ? '' : `<${name}>${value}</${name}>`;
    }).join('');

    return [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>',
      '<ComprobanteConstatarResponse xmlns="http://servicios1.afip.gob.ar/wscdc/"><ComprobanteConstatarResult>',
      options.result ? `<CmpResp>${echo}</CmpResp><Resultado>${options.result}</Resultado>` : '',
      list('Observaciones', 'Obs', options.observations),
      options.result ? '<FchProceso>20261117120000</FchProceso>' : '',
      list('Events', 'Evt', options.events),
      list('Errors', 'Err', options.errors),
      '</ComprobanteConstatarResult></ComprobanteConstatarResponse></soap:Body></soap:Envelope>',
    ].join('');
  };
}

const NOT_FOUND: Messages = [[100, 'El CAE informado no existe registrado y autorizado en las bases del organismo.']];
const CAEA_NOT_RENDERED: Messages = [[200, 'Existe CAEA, no fue rendido o no coincide con los datos registrados.']];

// ---------------------------------------------------------------------------------------------------------------
// Config y certificados en una carpeta temporal.
// ---------------------------------------------------------------------------------------------------------------

const keyPair = generateKeyPairSync('rsa', {
  modulusLength: 1024,
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' },
});

/** Un certificado como los de ARCA: "Computadores Test" en testing y "Computadores" en producción. */
function certificate(issuer: string): string {
  const cert = forge.pki.createCertificate();

  cert.publicKey = forge.pki.publicKeyFromPem(keyPair.publicKey);
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2026-01-01T15:00:00Z');
  cert.validity.notAfter = new Date('2027-11-17T15:00:00Z');
  cert.setSubject([
    { name: 'commonName', value: 'arcli' },
    { name: 'serialNumber', value: `CUIT ${CUIT}` },
  ]);
  cert.setIssuer([
    { name: 'commonName', value: issuer },
    { name: 'organizationName', value: 'AFIP' },
  ]);
  cert.sign(forge.pki.privateKeyFromPem(keyPair.privateKey) as forge.pki.rsa.PrivateKey, forge.md.sha256.create());

  return forge.pki.certificateToPem(cert);
}

let configDir = '';

function prepareConfig(config: Record<string, unknown> = {}): void {
  writeFileSync(join(configDir, 'testing.crt'), certificate('Computadores Test'));
  writeFileSync(join(configDir, 'produccion.crt'), certificate('Computadores'));
  writeFileSync(join(configDir, 'privada.key'), keyPair.privateKey);
  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify({
      cert: { produccion: join(configDir, 'produccion.crt'), testing: join(configDir, 'testing.crt') },
      cuit: CUIT,
      key: { produccion: join(configDir, 'privada.key'), testing: join(configDir, 'privada.key') },
      pdf: 'nunca',
      puntoVentaPorDefecto: 7,
      ...config,
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// El comando entero, como `index.ts`.
// ---------------------------------------------------------------------------------------------------------------

interface CliResult {
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
}

async function runCli(args: readonly string[]): Promise<CliResult> {
  let stdout = '';
  let stderr = '';

  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);

    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);

    return true;
  });

  const argv = ['node', 'arcli', ...args];
  const columns = [process.stdout.columns, process.stderr.columns] as const;

  process.stdout.columns = 0;
  process.stderr.columns = 0;
  process.env.NO_COLOR = '1';

  const failures: OutputFailures = new Map();

  try {
    await createProgram().parseAsync(argv);
    reportOutputFailure(failures, { commandError: undefined, json: false });
  } catch (error) {
    process.exitCode = reportCliError(error, shouldPrintErrorAsJson(argv), failures);
  } finally {
    [process.stdout.columns, process.stderr.columns] = columns;
    delete process.env.NO_COLOR;
    vi.mocked(process.stdout.write).mockRestore();
    vi.mocked(process.stderr.write).mockRestore();
  }

  return { code: Number(process.exitCode ?? 0), stderr, stdout };
}

/** `constatar … --json` que terminó con un resultado: el JSON de stdout. */
async function checked(args: readonly string[], code: 0 | 2 = 0): Promise<Record<string, unknown>> {
  const result = await runCli(['constatar', ...args, '--json']);

  expect(result, 'exit code').toMatchObject({ code });

  return JSON.parse(result.stdout) as Record<string, unknown>;
}

interface JsonError {
  readonly codigo: string;
  readonly detalles: unknown;
  readonly error: string;
  readonly sugerencia: string | null;
}

/** `constatar … --json` que terminó en error: el JSON de stderr, con exit 1 y nada en stdout. */
async function failed(args: readonly string[]): Promise<JsonError> {
  const result = await runCli(['constatar', ...args, '--json']);

  expect(result, 'exit 1 y nada en stdout').toMatchObject({ code: 1, stdout: '' });

  return JSON.parse(result.stderr) as JsonError;
}

/** Un error de entrada: se corta antes de pedir el ticket y de llamar a WSCDC, y el mensaje dice qué está mal. */
async function expectInputError(args: readonly string[], ...patterns: readonly RegExp[]): Promise<void> {
  const error = await failed(args);

  expect(error.codigo).toBe('INPUT_VALIDATION_ERROR');

  for (const pattern of patterns) {
    expect(error.error).toMatch(pattern);
  }

  expect(fake.login).not.toHaveBeenCalled();
  expect(fake.requests).toEqual([]);
}

beforeEach(() => {
  configDir = join(mkdtempSync(join(tmpdir(), 'arcli-constatar-')), 'config');
  mkdirSync(configDir);
  vi.stubEnv('ARCLI_CONFIG_DIR', configDir);
  process.exitCode = undefined;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  fake.requests.length = 0;
  fake.login.mockReset();
  fake.login.mockResolvedValue({});
  fake.answer.current = answer();
  prepareConfig();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  rmSync(dirname(configDir), { force: true, recursive: true });
});

// ---------------------------------------------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------------------------------------------

/** Una Factura A recibida: CAE, el receptor es quien consulta. */
const FA = ['fa', '00003-00001234', '--emisor', ISSUER, '-f', '10/11/2026', '-m', '12100', '--cae', CAE];
const FA_TO_ME = [...FA, '--cuit', CUIT];

/** Una Factura B sin receptor: hasta $ 10.000.000 no hace falta. */
function fb(amount: string, ...rest: string[]): string[] {
  return ['fb', '3-1234', '--emisor', ISSUER, '-f', '10/11/2026', '-m', amount, '--cae', CAE, ...rest];
}

const SENT_FA = {
  CbteFch: '20261110',
  CbteModo: 'CAE',
  CbteNro: '1234',
  CbteTipo: '1',
  CodAutorizacion: CAE,
  CuitEmisor: ISSUER,
  DocNroReceptor: CUIT,
  DocTipoReceptor: '80',
  ImpTotal: '12100',
  PtoVta: '3',
};

const CHECKED_FA = {
  atajo: 'fa',
  codigoAutorizacion: CAE,
  constatado: true,
  emisor: ISSUER,
  entorno: 'testing',
  errores: [],
  eventos: [],
  fecha: '20261110',
  fechaProceso: '20261117120000',
  importeTotal: 12100,
  modo: 'CAE',
  numero: 1234,
  observaciones: [],
  puntoVenta: 3,
  receptor: { numero: CUIT, tipoDocumento: 80 },
  resultado: 'A',
  tipoArca: 1,
};

/** El QR como lo arma `buildArcaQrUrl` de `@arcasdk/pdf`. */
function qr(json: Record<string, unknown> = {}, base = 'https://www.arca.gob.ar/fe/qr/?p='): string {
  const content = {
    ver: 1,
    fecha: '2026-11-10',
    cuit: Number(ISSUER),
    ptoVta: 3,
    tipoCmp: 1,
    nroCmp: 1234,
    importe: 12100,
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: 80,
    nroDocRec: Number(CUIT),
    tipoCodAut: 'E',
    codAut: Number(CAE),
    ...json,
  };

  return `${base}${Buffer.from(JSON.stringify(content)).toString('base64')}`;
}

describe('arcli constatar: contrato', () => {
  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('es un comando con sus flags', () => {
    const command = createProgram().commands.find((candidate) => candidate.name() === 'constatar');
    const flags = command?.options.flatMap((option) => [option.short, option.long]).filter(Boolean) ?? [];

    expect(flags).toEqual(
      expect.arrayContaining([
        '--emisor',
        '-f',
        '--fecha',
        '-m',
        '--monto',
        '--cae',
        '--caea',
        '--cuit',
        '--dni',
        '--cuil',
        '--qr',
      ]),
    );
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('tiene los códigos de error nuevos', () => {
    expect(ERROR_CODES).toEqual(expect.arrayContaining(['WSCDC_SERVICE_NOT_AUTHORIZED', 'ARCA_VOUCHER_CHECK_ERROR']));
  });
});

describe('arcli constatar: lo que llega a WSCDC', () => {
  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('pide el ticket de wscdc y manda el comprobante con el formato de WSCDC', async () => {
    await checked(FA_TO_ME);

    expect(fake.login).toHaveBeenCalledWith('wscdc');

    const { url, xml } = constatarRequest();

    expect(url).toBe(WSDL_URL.testing);
    expect(xml).toContain('http://servicios1.afip.gob.ar/wscdc/');
    expect({ Cuit: field(xml, 'Cuit'), Sign: field(xml, 'Sign'), Token: field(xml, 'Token') }).toEqual({
      Cuit: CUIT,
      Sign: WSAA.sign,
      Token: WSAA.token,
    });
    expect(sentVoucher()).toEqual(SENT_FA);
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('en producción va a la dirección de producción del WSDL', async () => {
    expect(await checked([...FA_TO_ME, '--produccion'])).toMatchObject({ entorno: 'produccion' });
    expect(constatarRequest().url).toBe(WSDL_URL.produccion);
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each([
    ['00003-00001234', '3', '1234'],
    ['3-1234', '3', '1234'],
    ['99998-99999999', '99998', '99999999'],
  ])('el comprobante %s es el punto de venta %s y el número %s', async (voucher, pointOfSale, number) => {
    await checked(['fa', voucher, ...FA_TO_ME.slice(2)]);

    expect(sentVoucher()).toMatchObject({ CbteNro: number, PtoVta: pointOfSale });
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each([
    ['10/11/2026', '20261110'],
    ['10-11-2026', '20261110'],
    ['10/11/26', '20261110'],
    ['10/11', '20261110'],
    ['ayer', '20261116'],
    ['-7', '20261110'],
  ])('-f %s se manda como %s', async (date, sent) => {
    await checked([...FA_TO_ME.slice(0, 4), '-f', date, ...FA_TO_ME.slice(6)]);

    expect(sentVoucher()).toMatchObject({ CbteFch: sent });
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each([
    ['12.100', '12100'],
    ['1.500,50', '1500.5'],
    ['0', '0'],
  ])('-m %s se manda como %s', async (amount, sent) => {
    await checked([...FA_TO_ME.slice(0, 6), '-m', amount, ...FA_TO_ME.slice(8)]);

    expect(sentVoucher()).toMatchObject({ ImpTotal: sent });
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each<[string, string, number, string | null]>([
    ['fa', '1', 1, 'fa'],
    ['FA', '1', 1, 'fa'],
    ['nca', '3', 3, 'nca'],
    ['fcea', '201', 201, 'fcea'],
    ['1', '1', 1, 'fa'],
    ['201', '201', 201, 'fcea'],
    // La M no la emite ARCLI: se constata con el código de ARCA y sin atajo.
    ['51', '51', 51, null],
  ])('el tipo %s es el %s de ARCA', async (kind, sent, tipoArca, atajo) => {
    expect(await checked([kind, ...FA_TO_ME.slice(1)])).toMatchObject({ atajo, tipoArca });
    expect(sentVoucher()).toMatchObject({ CbteTipo: sent });
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('--caea manda el modo CAEA', async () => {
    const args = [...FA_TO_ME.slice(0, 8), '--caea', CAE, '--cuit', CUIT];

    expect(await checked(args)).toMatchObject({ codigoAutorizacion: CAE, modo: 'CAEA' });
    expect(sentVoucher()).toMatchObject({ CbteModo: 'CAEA', CodAutorizacion: CAE });
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('en una B de hasta $ 10.000.000 sin receptor no manda ni el tipo ni el número de documento', async () => {
    expect(await checked(fb('10.000.000'))).toMatchObject({ receptor: null, tipoArca: 6 });

    const { xml } = constatarRequest();

    expect(hasElement(xml, 'DocTipoReceptor')).toBe(false);
    expect(hasElement(xml, 'DocNroReceptor')).toBe(false);
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each([
    ['--dni', '11111111', '96'],
    ['--cuil', '20111111112', '86'],
    ['--cuit', '30709965812', '80'],
  ])('en una B de más de $ 10.000.000, %s manda el documento %s con el tipo %s', async (flag, number, type) => {
    expect(await checked(fb('10.000.000,01', flag, number))).toMatchObject({
      receptor: { numero: number, tipoDocumento: Number(type) },
    });
    expect(sentVoucher()).toMatchObject({ DocNroReceptor: number, DocTipoReceptor: type });
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('con --qr manda lo del QR', async () => {
    expect(await checked(['--qr', qr()])).toEqual(CHECKED_FA);
    expect(sentVoucher()).toEqual(SENT_FA);
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('con --qr de la base de AFIP y un CAEA', async () => {
    await checked(['--qr', qr({ tipoCodAut: 'A' }, 'https://www.afip.gob.ar/fe/qr/?p=')]);

    expect(sentVoucher()).toMatchObject({ CbteModo: 'CAEA' });
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('con --qr de un consumidor final (99/0) no manda el receptor', async () => {
    expect(await checked(['--qr', qr({ nroDocRec: 0, tipoCmp: 6, tipoDocRec: 99 })])).toMatchObject({
      receptor: null,
    });

    const { xml } = constatarRequest();

    expect(hasElement(xml, 'DocTipoReceptor')).toBe(false);
    expect(hasElement(xml, 'DocNroReceptor')).toBe(false);
  });
});

describe('arcli constatar: resultado', () => {
  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('constatado: Resultado A, exit 0 y el JSON completo', async () => {
    expect(await checked(FA_TO_ME)).toEqual(CHECKED_FA);
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('no constatado: Resultado R con el motivo en Observaciones, exit 2', async () => {
    fake.answer.current = answer({ observations: NOT_FOUND, result: 'R' });

    expect(await checked(FA_TO_ME, 2)).toEqual({
      ...CHECKED_FA,
      constatado: false,
      observaciones: [{ codigo: NOT_FOUND[0]![0], mensaje: NOT_FOUND[0]![1] }],
      resultado: 'R',
    });
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('no constatado en texto: exit 2 y el motivo de ARCA a la vista', async () => {
    fake.answer.current = answer({ observations: NOT_FOUND, result: 'R' });

    const result = await runCli(['constatar', ...FA_TO_ME]);

    expect(result.code).toBe(2);
    expect(result.stdout + result.stderr).toContain(NOT_FOUND[0]![1]);
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('constatado con la observación 200 (CAEA sin rendir): sigue constatado, con la observación', async () => {
    fake.answer.current = answer({ observations: CAEA_NOT_RENDERED, result: 'A' });

    expect(await checked([...FA_TO_ME.slice(0, 8), '--caea', CAE, '--cuit', CUIT])).toEqual({
      ...CHECKED_FA,
      modo: 'CAEA',
      observaciones: [{ codigo: 200, mensaje: CAEA_NOT_RENDERED[0]![1] }],
    });
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('constatado con la observación 200 en texto: exit 0 y la observación como aviso', async () => {
    fake.answer.current = answer({ observations: CAEA_NOT_RENDERED, result: 'A' });

    const result = await runCli(['constatar', ...FA_TO_ME.slice(0, 8), '--caea', CAE, '--cuit', CUIT]);

    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toContain(CAEA_NOT_RENDERED[0]![1]);
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('constatado en texto: exit 0 y el comprobante a la vista', async () => {
    const result = await runCli(['constatar', ...FA_TO_ME]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('00003-00001234');
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('los eventos de ARCA salen en eventos', async () => {
    fake.answer.current = answer({ events: [[1, 'Mensaje de prueba de WSCDC.']], result: 'A' });

    expect(await checked(FA_TO_ME)).toMatchObject({
      eventos: [{ codigo: 1, mensaje: 'Mensaje de prueba de WSCDC.' }],
    });
  });
});

describe('arcli constatar: errores de ARCA', () => {
  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('sin autorización para wscdc en WSAA: WSCDC_SERVICE_NOT_AUTHORIZED, sin llamar a WSCDC', async () => {
    fake.login.mockRejectedValue(new Error('ns1:coe.notAuthorized: Computador no autorizado a acceder al servicio'));

    const error = await failed(FA_TO_ME);

    expect(error).toMatchObject({ codigo: 'WSCDC_SERVICE_NOT_AUTHORIZED', error: expect.stringContaining('wscdc') });
    expect(error.sugerencia).toEqual(expect.stringContaining('WSASS'));
    expect(fake.requests).toEqual([]);
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each<[number, string]>([
    [600, 'ValidacionDeToken: No validaron las firmas digitales.'],
    [601, 'CUIT representada no incluida en Token.'],
  ])('el error %s de WSCDC: WSCDC_SERVICE_NOT_AUTHORIZED', async (code, message) => {
    fake.answer.current = answer({ errors: [[code, message]] });

    expect(await failed(FA_TO_ME)).toMatchObject({ codigo: 'WSCDC_SERVICE_NOT_AUTHORIZED' });
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails(
    'un error de formato (Resultado R con Errors): ARCA_VOUCHER_CHECK_ERROR, no un "no constatado"',
    async () => {
      fake.answer.current = answer({ errors: [[2, 'El campo CuitEmisor es invalido.']], result: 'R' });

      expect(await failed(FA_TO_ME)).toMatchObject({
        codigo: 'ARCA_VOUCHER_CHECK_ERROR',
        error: expect.stringContaining('El campo CuitEmisor es invalido.'),
      });
    },
  );

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each<[number, string]>([
    [500, 'Error interno de aplicación.'],
    [501, 'Error interno de base de datos.'],
    [503, 'No existen datos en nuestros registros.'],
  ])('Errors %s sin Resultado: ARCA_VOUCHER_CHECK_ERROR con el mensaje de ARCA', async (code, message) => {
    fake.answer.current = answer({ errors: [[code, message]] });

    expect(await failed(FA_TO_ME)).toMatchObject({
      codigo: 'ARCA_VOUCHER_CHECK_ERROR',
      error: expect.stringContaining(message),
    });
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('una respuesta sin Resultado ni Errors: ARCA_VOUCHER_CHECK_ERROR, no un "no constatado"', async () => {
    fake.answer.current = answer({});

    expect(await failed(FA_TO_ME)).toMatchObject({ codigo: 'ARCA_VOUCHER_CHECK_ERROR' });
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('la transacción activa (502) es pasajera: TRANSIENT_ERROR', async () => {
    fake.answer.current = answer({ errors: [[502, 'Transacción Activa']] });

    expect(await failed(FA_TO_ME)).toMatchObject({ codigo: 'TRANSIENT_ERROR' });
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('una sesión abierta en WSAA es pasajera: TRANSIENT_ERROR, sin llamar a WSCDC', async () => {
    fake.login.mockRejectedValue(new Error('ns1:coe.alreadyAuthenticated'));

    expect(await failed(FA_TO_ME)).toMatchObject({ codigo: 'TRANSIENT_ERROR' });
    expect(fake.requests).toEqual([]);
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('sin conexión con WSCDC: error (exit 1), nunca un "no constatado"', async () => {
    fake.answer.current = () => new Error('connect ETIMEDOUT 127.0.0.1:443');

    // "Como siempre": ARCA_UNAVAILABLE en `estado`, UNEXPECTED_ERROR en las consultas (ver json-golden.test.ts).
    expect((await failed(FA_TO_ME)).codigo).toMatch(/^(?:ARCA_UNAVAILABLE|UNEXPECTED_ERROR)$/);
  });
});

describe('arcli constatar: entradas inválidas', () => {
  const REQUIRED: ReadonlyArray<readonly [string, number, number, RegExp]> = [
    // [qué falta, desde, cuántos se sacan de FA_TO_ME, qué dice el error]
    ['el tipo y el comprobante', 0, 2, /tipo|--qr/i],
    ['el comprobante', 1, 1, /comprobante/i],
    ['--emisor', 2, 2, /--emisor/],
    ['-f', 4, 2, /-f\b|--fecha/],
    ['-m', 6, 2, /-m\b|--monto/],
    ['--cae o --caea', 8, 2, /--cae\b.*--caea|--caea.*--cae\b/],
  ];

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each(REQUIRED)('sin %s: INPUT_VALIDATION_ERROR que lo nombra', async (_name, start, count, pattern) => {
    const args = [...FA_TO_ME];

    args.splice(start, count);

    await expectInputError(args, pattern);
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('--cae y --caea juntos', async () => {
    await expectInputError([...FA_TO_ME, '--caea', CAE], /--cae\b/, /--caea/);
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each([
    ['--emisor', ['--qr', qr(), '--emisor', ISSUER]],
    ['el tipo', ['fa', '--qr', qr()]],
    ['-m', ['--qr', qr(), '-m', '100']],
    ['--cae', ['--qr', qr(), '--cae', CAE]],
    ['--cuit', ['--qr', qr(), '--cuit', CUIT]],
  ])('--qr con %s', async (_name, args) => {
    await expectInputError(args, /--qr/);
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each([
    ['una base ajena', qr({}, 'https://example.com/fe/qr/?p='), /arca\.gob\.ar\/fe\/qr/],
    ['otra versión', qr({ ver: 2 }), /versi[oó]n/i],
    ['un JSON roto', `https://www.arca.gob.ar/fe/qr/?p=${Buffer.from('{"ver":1,').toString('base64')}`, /QR/],
  ])('--qr con %s', async (_name, url, pattern) => {
    await expectInputError(['--qr', url], pattern);
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each(['fa', 'nca', 'nda', 'fcea', 'ncea', '1', '201'])(
    'en %s el receptor es obligatorio, y el error dice que va --cuit',
    async (kind) => {
      await expectInputError([kind, ...FA.slice(1)], /--cuit/);
    },
  );

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each([
    ['fa', '--dni', '11111111'],
    ['fa', '--cuil', '20111111112'],
    ['fcea', '--dni', '11111111'],
  ])('en %s el receptor solo puede ser un CUIT: %s no', async (kind, flag, number) => {
    await expectInputError([kind, ...FA.slice(1), flag, number], /CUIT|--cuit/, new RegExp(flag));
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each(['fb', 'fc', 'ncb', 'fceb'])(
    'en %s de más de $ 10.000.000 el receptor es obligatorio, y el error dice el tope',
    async (kind) => {
      await expectInputError([kind, ...fb('10.000.000,01').slice(1)], /10\.000\.000/);
    },
  );

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('dos receptores a la vez', async () => {
    await expectInputError(fb('20.000.000', '--cuit', ISSUER, '--dni', '11111111'), /--cuit/, /--dni/);
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each(['zz', '0', '1x'])('el tipo %s no es válido', async (kind) => {
    await expectInputError([kind, ...FA_TO_ME.slice(1)], new RegExp(`"?${kind}"?`), /tipo/i);
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each(['1234', '3-0', '0-1234', '99999-1', '3-123456789', 'a-b', '3--1234', '00003_00001234'])(
    'el comprobante %s no es válido',
    async (voucher) => {
      await expectInputError(['fa', voucher, ...FA_TO_ME.slice(2)], new RegExp(voucher.replace(/[-]/g, '\\-')));
    },
  );

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each(['31/02/2026', 'mañana', '20261110x'])('-f %s no es válida', async (date) => {
    await expectInputError([...FA_TO_ME.slice(0, 4), '-f', date, ...FA_TO_ME.slice(6)], new RegExp(date));
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each(['abc', '-5', '1,2,3'])('-m %s no es válido', async (amount) => {
    await expectInputError([...FA_TO_ME.slice(0, 6), '-m', amount, ...FA_TO_ME.slice(8)], /-m\b|--monto/);
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each(['30709965813', '123'])('--emisor %s no es un CUIT válido', async (cuit) => {
    await expectInputError(['fa', '3-1234', '--emisor', cuit, ...FA_TO_ME.slice(4)], /--emisor/, new RegExp(cuit));
  });

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails.each(['123', '7646392658534A', '764639265853410'])(
    'el código de autorización %s no tiene 14 dígitos',
    async (code) => {
      await expectInputError([...FA.slice(0, 8), '--cae', code, '--cuit', CUIT], /14/, new RegExp(code));
    },
  );

  // Tests primero (SDK-10): pasa a it() al implementarlo.
  it.fails('--cuit del receptor con el dígito verificador mal', async () => {
    await expectInputError([...FA, '--cuit', '20111111113'], /--cuit/, /20111111113/);
  });
});
