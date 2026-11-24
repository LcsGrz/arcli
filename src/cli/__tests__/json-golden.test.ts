import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import forge from 'node-forge';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { reportCliError, shouldPrintErrorAsJson } from '../error-output';
import { createProgram } from '../program';

/**
 * Salida dorada del `--json` (REV-47): para cada caso, el comando entero como lo corre `index.ts` (commander, config
 * real en una carpeta temporal y el error impreso por `reportCliError`), con el SDK de ARCA falso. Cada caso se
 * compara byte a byte con su archivo en `__golden__/`: exit code, stdout y stderr.
 *
 * Un cambio en esos archivos es un cambio de contrato (ver "Contrato público" en AGENTS.md). Para regenerarlos a
 * propósito: `yarn test src/cli/__tests__/json-golden.test.ts -u`, y revisar el diff.
 *
 * Lo no determinista sale de aca: el reloj fijo (`NOW`), el CAE y los numeros del SDK falso y la carpeta de config,
 * que en los archivos se ve como `<config>`.
 */

// Las fechas (de hoy, de vencimiento) se calculan en hora local: se fija la de Argentina para que el archivo dorado
// sea el mismo en cualquier equipo o CI.
const originalTimeZone = process.env.TZ;

process.env.TZ = 'America/Argentina/Buenos_Aires';

afterAll(() => {
  if (originalTimeZone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimeZone;
  }
});

/** 17/11/2026 al mediodia de Buenos Aires: la misma fecha en cualquier huso de CI. */
const NOW = new Date('2026-11-17T15:00:00Z');
const CUIT = 20111111112;
const CLIENT_CUIT = 30709965812;

/** El SDK falso: cada test cambia lo que devuelve con `mockResolvedValue` o `mockRejectedValue`. */
const sdk = vi.hoisted(() => ({
  generic: { call: vi.fn() },
  padron: { getTaxpayerDetails: vi.fn() },
  wsfe: {
    createVoucher: vi.fn(),
    getLastVoucher: vi.fn(),
    getQuotation: vi.fn(),
    getSalesPoints: vi.fn(),
    getServerStatus: vi.fn(),
    getVoucherTypes: vi.fn(),
  },
  wsfecred: { consultarMontoObligadoRecepcion: vi.fn() },
  wsfex: {
    authorize: vi.fn(),
    checkPermiso: vi.fn(),
    getCmp: vi.fn(),
    getLastCmp: vi.fn(),
    getLastId: vi.fn(),
    getParamActividades: vi.fn(),
    getParamDstCuit: vi.fn(),
    getParamDstPais: vi.fn(),
    getParamIdiomas: vi.fn(),
    getParamIncoterms: vi.fn(),
    getParamMon: vi.fn(),
    getParamMonConCotizacion: vi.fn(),
    getParamUMed: vi.fn(),
  },
}));

vi.mock('@arcasdk/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Arca: class {
    public readonly electronicBillingService = sdk.wsfe;
    public readonly genericService = sdk.generic;
    public readonly registerInscriptionProofService = sdk.padron;
    public readonly wsfecredService = sdk.wsfecred;
    public readonly wsfexService = sdk.wsfex;
  },
  AuthRepository: class {
    public getAuthParams() {
      return { Auth: { Cuit: 20111111112, Sign: 'firma', Token: 'token' } };
    }

    public async login() {
      return {};
    }
  },
}));

// ---------------------------------------------------------------------------------------------------------------
// Respuestas del SDK, con la forma que tienen en ARCA.
// ---------------------------------------------------------------------------------------------------------------

interface WsfeRequest {
  readonly CbteDesde: number;
  readonly CbteFch: string;
  readonly CbteHasta: number;
  readonly CbteTipo: number;
  readonly Concepto: number;
  readonly DocNro: number;
  readonly DocTipo: number;
  readonly PtoVta: number;
}

type Obs = ReadonlyArray<{ readonly Code: number; readonly Msg: string }>;

/** `FECAESolicitar` con el numero y la fecha de la solicitud; sin CAE si se rechaza. */
function wsfeAnswer(
  result: 'A' | 'R',
  extra: { readonly errors?: Obs; readonly events?: Obs; readonly observations?: Obs } = {},
) {
  return async (request: WsfeRequest) => ({
    cae: result === 'A' ? '76463926585341' : '',
    caeFchVto: result === 'A' ? '20261127' : '',
    response: {
      ...(extra.errors ? { Errors: { Err: extra.errors } } : {}),
      ...(extra.events ? { Events: { Evt: extra.events } } : {}),
      FeCabResp: {
        CantReg: 1,
        CbteTipo: request.CbteTipo,
        Cuit: CUIT,
        FchProceso: '20261117120000',
        PtoVta: request.PtoVta,
        Reproceso: 'N',
        Resultado: result,
      },
      FeDetResp: {
        FECAEDetResponse: [
          {
            CAE: result === 'A' ? '76463926585341' : '',
            CAEFchVto: result === 'A' ? '20261127' : '',
            CbteDesde: request.CbteDesde,
            CbteFch: request.CbteFch,
            CbteHasta: request.CbteHasta,
            Concepto: request.Concepto,
            DocNro: request.DocNro,
            DocTipo: request.DocTipo,
            ...(extra.observations ? { Observaciones: { Obs: extra.observations } } : {}),
            Resultado: result,
          },
        ],
      },
    },
  });
}

/** `FECompConsultar` de la factura que ajusta una nota: la 3-12, del 10/11, aprobada. */
function issuedVoucher(overrides: Record<string, unknown> = {}) {
  return {
    CbteFch: '20261110',
    CodAutorizacion: '76000000000012',
    Concepto: 2,
    DocNro: 0,
    DocTipo: 99,
    FchVto: '20261120',
    ImpIVA: 0,
    ImpNeto: 5000,
    ImpOpEx: 0,
    ImpTotConc: 0,
    ImpTotal: 5000,
    ImpTrib: 0,
    MonCotiz: 1,
    MonId: 'PES',
    Resultado: 'A',
    ...overrides,
  };
}

/** `FECompConsultar` con un error que no es el 602 (ERR-1), para los numeros pedidos o para todos. */
function failingQuery(numbers?: readonly number[]) {
  return async (service: string, method: string, params: { FeCompConsReq: { CbteNro: number } }) =>
    !numbers || numbers.includes(params.FeCompConsReq.CbteNro)
      ? { FECompConsultarResult: { Errors: { Err: [{ Code: 600, Msg: 'ValidacionDeToken: No aparecio CUIT.' }] } } }
      : consulting(issuedVoucher())(service, method);
}

/** `FECompConsultar` por `genericService` (SDK-13): devuelve `resultGet`, o el 602 si es `null`. */
function consulting(resultGet: Record<string, unknown> | null) {
  return async (_service: string, method: string) => {
    if (method !== 'FECompConsultar') {
      throw new Error(`genericService.call(${method}) sin respuesta falsa`);
    }

    return {
      FECompConsultarResult: resultGet
        ? { ResultGet: resultGet }
        : {
            Errors: {
              Err: [{ Code: 602, Msg: 'No existen datos en nuestros registros para los parametros ingresados.' }],
            },
          },
    };
  };
}

const NO_FEX_ERROR = { FEXErr: { ErrCode: 0, ErrMsg: 'OK' }, FEXEvents: { EventCode: 0, EventMsg: 'OK' } };

/** `FEXAuthorize`: la E 4-8 con su CAE, o rechazada con el motivo. */
function wsfexAnswer(result: 'A' | 'R') {
  return async (input: { Cmp: { Cbte_nro: number; Cbte_Tipo: number; Fecha_cbte: string; Id: number } }) => ({
    FEXAuthorizeResult: {
      ...NO_FEX_ERROR,
      FEXResultAuth: {
        Cae: result === 'A' ? '76463926585399' : '',
        Cbte_nro: input.Cmp.Cbte_nro,
        Cbte_tipo: input.Cmp.Cbte_Tipo,
        Cuit: CUIT,
        Fch_cbte: input.Cmp.Fecha_cbte,
        Fch_venc_Cae: result === 'A' ? '20261127' : '',
        Id: input.Cmp.Id,
        Motivos_Obs: result === 'R' ? '1560: El campo Dst_cmp no es valido.' : '',
        Punto_vta: 4,
        Reproceso: 'N',
        Resultado: result,
      },
    },
  });
}

/** `FEXGetCMP` de la E 4-1 que ajustan las notas: servicios a Estados Unidos, USD 1.500. */
const EXPORT_INVOICE = {
  FEXGetCMPResult: {
    ...NO_FEX_ERROR,
    FEXResultGet: {
      Actividades: { Actividad: { Id: 620100 } },
      Cae: '76463926585300',
      CanMisMonExt: 'N',
      Cbte_nro: 1,
      Cbte_tipo: 19,
      Cliente: 'ACME LLC',
      Cuit_pais_cliente: 55000002126,
      Domicilio_cliente: '123 Main St',
      Dst_cmp: 212,
      Fch_venc_Cae: '20261110',
      Fecha_cbte: '20261030',
      Forma_pago: 'Transferencia Internacional',
      Idioma_cbte: 1,
      Imp_total: 1500,
      Items: {
        Item: {
          Pro_ds: 'Servicios de consultoría',
          Pro_precio_uni: 1500,
          Pro_qty: 1,
          Pro_total_item: 1500,
          Pro_umed: 7,
        },
      },
      Moneda_Id: 'DOL',
      Moneda_ctz: 1000,
      Punto_vta: 4,
      Resultado: 'A',
      Tipo_expo: 2,
    },
  },
};

function resetSdk(): void {
  for (const service of Object.values(sdk)) {
    for (const mock of Object.values(service)) {
      mock.mockReset();
    }
  }

  sdk.wsfe.getLastVoucher.mockResolvedValue({ cbteNro: 41 });
  sdk.wsfe.createVoucher.mockImplementation(wsfeAnswer('A'));
  sdk.wsfe.getQuotation.mockResolvedValue({ resultGet: { fchCotiz: '20261116', monCotiz: 1452.5, monId: 'DOL' } });
  sdk.generic.call.mockImplementation(consulting(issuedVoucher()));
  sdk.wsfe.getServerStatus.mockResolvedValue({ appServer: 'OK', authServer: 'OK', dbServer: 'OK' });
  sdk.padron.getTaxpayerDetails.mockResolvedValue({
    datosGenerales: {
      domicilioFiscal: {
        codPostal: '1425',
        descripcionProvincia: 'CIUDAD AUTONOMA BUENOS AIRES',
        direccion: 'AV SIEMPRE VIVA 742',
      },
      estadoClave: 'ACTIVO',
      razonSocial: 'CLIENTE DE PRUEBA SA',
      tipoPersona: 'JURIDICA',
    },
    datosRegimenGeneral: { impuesto: [{ descripcionImpuesto: 'IVA', estadoImpuesto: 'AC', idImpuesto: 30 }] },
  });
  sdk.wsfecred.consultarMontoObligadoRecepcion.mockResolvedValue({
    consultarMontoObligadoRecepcionReturn: { montoDesde: 3958316, obligado: 'S' },
  });

  sdk.wsfex.authorize.mockImplementation(wsfexAnswer('A'));
  sdk.wsfex.getCmp.mockResolvedValue(EXPORT_INVOICE);
  sdk.wsfex.checkPermiso.mockResolvedValue({
    FEXCheck_PermisoResult: { ...NO_FEX_ERROR, FEXResultGet: { Status: 'OK' } },
  });
  sdk.wsfex.getLastCmp.mockResolvedValue({
    FEXGetLast_CMPResult: { ...NO_FEX_ERROR, FEXResult_LastCMP: { Cbte_nro: 7 } },
  });
  sdk.wsfex.getLastId.mockResolvedValue({ FEXGetLast_IDResult: { ...NO_FEX_ERROR, FEXResultGet: { Id: 41 } } });
  sdk.wsfex.getParamActividades.mockResolvedValue({
    FEXGetPARAM_ActividadesResult: {
      ...NO_FEX_ERROR,
      FEXResultGet: { ClsFEXResponse_ActividadTipo: [{ Desc: 'SERVICIOS DE CONSULTORES EN INFORMATICA', Id: 620100 }] },
    },
  });
  sdk.wsfex.getParamMon.mockResolvedValue({
    FEXGetPARAM_MONResult: {
      ...NO_FEX_ERROR,
      FEXResultGet: { ClsFEXResponse_Mon: [{ Mon_Ds: 'Dolar Estadounidense', Mon_Id: 'DOL' }] },
    },
  });
  sdk.wsfex.getParamDstPais.mockResolvedValue({
    FEXGetPARAM_DST_paisResult: {
      ...NO_FEX_ERROR,
      FEXResultGet: { ClsFEXResponse_DST_pais: [{ DST_Codigo: 212, DST_Ds: 'ESTADOS UNIDOS' }] },
    },
  });
  sdk.wsfex.getParamDstCuit.mockResolvedValue({
    FEXGetPARAM_DST_CUITResult: {
      ...NO_FEX_ERROR,
      FEXResultGet: {
        ClsFEXResponse_DST_cuit: [{ DST_CUIT: 55000002126, DST_Ds: 'ESTADOS UNIDOS - Persona Jurídica' }],
      },
    },
  });
  sdk.wsfex.getParamIncoterms.mockResolvedValue({
    FEXGetPARAM_IncotermsResult: {
      ...NO_FEX_ERROR,
      FEXResultGet: { ClsFEXResponse_Inc: [{ Inc_Ds: 'Free on Board', Inc_Id: 'FOB' }] },
    },
  });
  sdk.wsfex.getParamIdiomas.mockResolvedValue({
    FEXGetPARAM_IdiomasResult: {
      ...NO_FEX_ERROR,
      FEXResultGet: { ClsFEXResponse_Idi: [{ Idi_Ds: 'Español', Idi_Id: 1 }] },
    },
  });
  sdk.wsfex.getParamUMed.mockResolvedValue({
    FEXGetPARAM_UMedResult: {
      ...NO_FEX_ERROR,
      FEXResultGet: { ClsFEXResponse_UMed: [{ Umed_Ds: 'unidades', Umed_Id: 7 }] },
    },
  });
  sdk.wsfex.getParamMonConCotizacion.mockResolvedValue({
    FEXGetPARAM_MON_CON_COTIZACIONResult: {
      ...NO_FEX_ERROR,
      FEXResultGet: {
        ClsFEXResponse_Mon_CON_Cotizacion: [{ Fecha_ctz: '16/11/2026', Mon_Id: 'DOL', Mon_ctz: 1450.25 }],
      },
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Config y certificados en una carpeta temporal.
// ---------------------------------------------------------------------------------------------------------------

const keyPair = generateKeyPairSync('rsa', {
  modulusLength: 1024,
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' },
});

/** Otra clave, para un certificado que no corresponde a la configurada. */
const otherKeyPair = generateKeyPairSync('rsa', {
  modulusLength: 1024,
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' },
});

/**
 * Un certificado como los de ARCA testing (emisor "Computadores Test", CUIT en `serialNumber`), con el vencimiento
 * pedido. Vence a las 15 UTC: el mismo dia en Buenos Aires.
 */
function certificate(
  notAfter: string,
  options: { readonly cuit?: number; readonly issuer?: string; readonly otherKey?: boolean } = {},
): string {
  const cert = forge.pki.createCertificate();
  const pair = options.otherKey ? otherKeyPair : keyPair;

  cert.publicKey = forge.pki.publicKeyFromPem(pair.publicKey);
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2026-01-01T15:00:00Z');
  cert.validity.notAfter = new Date(`${notAfter}T15:00:00Z`);
  cert.setSubject([
    { name: 'commonName', value: 'arcli' },
    { name: 'serialNumber', value: `CUIT ${options.cuit ?? CUIT}` },
  ]);
  cert.setIssuer([
    { name: 'commonName', value: options.issuer ?? 'Computadores Test' },
    { name: 'organizationName', value: 'AFIP' },
  ]);
  cert.sign(forge.pki.privateKeyFromPem(pair.privateKey) as forge.pki.rsa.PrivateKey, forge.md.sha256.create());

  return forge.pki.certificateToPem(cert);
}

let VALID_CERT = '';

beforeAll(() => {
  VALID_CERT = certificate('2027-11-17');
});

let configDir = '';

interface Setup {
  /** Claves de config.json (la forma guardada, no la publica), sobre las de siempre. */
  readonly config?: Record<string, unknown>;
  /** El certificado de testing; por defecto, uno que vence en un año. */
  readonly cert?: string;
  /** Sin config.json, o con este texto tal cual. */
  readonly rawConfig?: string;
}

function prepareConfig(setup: Setup): void {
  writeFileSync(join(configDir, 'testing.crt'), setup.cert ?? VALID_CERT);
  writeFileSync(join(configDir, 'testing.key'), keyPair.privateKey);

  if (setup.rawConfig !== undefined) {
    writeFileSync(join(configDir, 'config.json'), setup.rawConfig);

    return;
  }

  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify({
      cert: { testing: join(configDir, 'testing.crt') },
      cuit: String(CUIT),
      exportacion: { actividad: 620100 },
      key: { testing: join(configDir, 'testing.key') },
      pdf: 'nunca',
      puntoVentaPorDefecto: 3,
      ...setup.config,
    }),
  );
}

function writeInput(name: string, content: unknown): string {
  const path = join(configDir, name);

  writeFileSync(path, JSON.stringify(content));

  return path;
}

// ---------------------------------------------------------------------------------------------------------------
// El comando entero, como `index.ts`.
// ---------------------------------------------------------------------------------------------------------------

async function runCli(args: readonly string[]): Promise<{ code: number; stderr: string; stdout: string }> {
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
  // Los paneles de stderr (el aviso del certificado) se ajustan al ancho de la terminal y llevan color si es una:
  // sin terminal, como en CI.
  const columns = [process.stdout.columns, process.stderr.columns] as const;

  process.stdout.columns = 0;
  process.stderr.columns = 0;
  process.env.NO_COLOR = '1';

  try {
    await createProgram().parseAsync(argv);
  } catch (error) {
    process.exitCode = reportCliError(error, shouldPrintErrorAsJson(argv));
  } finally {
    [process.stdout.columns, process.stderr.columns] = columns;
    delete process.env.NO_COLOR;
    vi.mocked(process.stdout.write).mockRestore();
    vi.mocked(process.stderr.write).mockRestore();
  }

  const code = Number(process.exitCode ?? 0);

  return { code, stderr, stdout };
}

/**
 * La carpeta temporal cambia en cada corrida: en el archivo dorado se ve como `<config>`. En Windows la ruta usa `\`
 * (y `\\` dentro de un JSON): se buscan esas formas y lo que sigue a `<config>` pasa a `/`, asi el archivo es el mismo
 * en todos los sistemas.
 */
function normalize(text: string): string {
  const paths = [...new Set([realpathSync(configDir), realpathSync.native(configDir), configDir])];
  const forms = paths.flatMap((path) => [path.replaceAll('\\', '\\\\'), path]);

  return forms
    .reduce((result, path) => result.split(path).join('<config>'), text)
    .replace(/<config>(?:\\{1,2}[\w.-]+)+/g, (match) => match.replace(/\\{1,2}/g, '/'));
}

async function golden(name: string, args: readonly string[], setup: Setup = {}): Promise<void> {
  prepareConfig(setup);

  const result = await runCli(args);
  const text = [
    `$ arcli ${args.map((arg) => normalize(arg)).join(' ')}`,
    `exit: ${result.code}`,
    '--- stdout ---',
    normalize(result.stdout),
    '--- stderr ---',
    normalize(result.stderr),
  ].join('\n');

  await expect(text).toMatchFileSnapshot(`__golden__/${name}.txt`);
}

beforeEach(() => {
  // Con nombre fijo adentro de la temporal: algunos mensajes acortan la ruta a `.../config/archivo`.
  configDir = join(mkdtempSync(join(tmpdir(), 'arcli-golden-')), 'config');
  mkdirSync(configDir);
  vi.stubEnv('ARCLI_CONFIG_DIR', configDir);
  process.exitCode = undefined;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetSdk();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Vuelve al ARCLI_CONFIG_DIR temporal del setup, no a la carpeta real.
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  rmSync(dirname(configDir), { force: true, recursive: true });
});

// ---------------------------------------------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------------------------------------------

const FC = ['fc', '-m', '1000', '--cs', '--cfinal'];
const FA = ['fa', '-m', '12100', '--cs', '--cuit', String(CLIENT_CUIT), '--ir-ri'];
const FB = ['fb', '-m', '12100', '--cs', '--cfinal'];
const FCEA = [
  'fcea',
  '-m',
  '5000000',
  '--cs',
  '--cuit',
  String(CLIENT_CUIT),
  '--ir-ri',
  '--cbu',
  '0110599520000012345678',
];
const NCC = [
  'ncc',
  '-m',
  '1000',
  '--cs',
  '--cfinal',
  '--ac',
  'fc',
  '--apv',
  '3',
  '--ar',
  '12',
  '--acuit',
  String(CUIT),
];
const FE = [
  'fe',
  ...['--cliente', 'ACME LLC', '--domicilio-cliente', '123 Main St', '--pais-destino', '212', '-m', '1500'],
  ...['--item', '001|Servicios de consultoría|1|1500|unidad'],
];
const FE_GOODS = [
  ...FE,
  '--tipo-expo',
  '1',
  '--incoterm',
  'FOB',
  '--permiso-existente',
  '--permiso',
  '26001EC01000123A',
];
const NCE = ['nce', '-m', '500', '--ar', '1', '--apv', '4', '--pv', '4'];

function batchItem(montoTotal: number, extra: Record<string, unknown> = {}) {
  return {
    concepto: 'servicios',
    ivaReceptor: 'consumidor-final',
    montoTotal,
    tipoDocumento: 'consumidor-final',
    ...extra,
  };
}

describe('A, B y C', () => {
  it('fc vista previa', () => golden('fc-previsualizar', [...FC, '--previsualizar', '--json']));
  it('fc sin flag de emision queda en vista previa', () => golden('fc-sin-flag', [...FC, '--json']));
  it('fc aprobada', () => golden('fc-aprobada', [...FC, '--emitir', '--json']));
  it('fc aprobada con --bruto', () => golden('fc-aprobada-bruto', [...FC, '--emitir', '--json', '--bruto']));
  it('fc vista previa con --bruto', () =>
    golden('fc-previsualizar-bruto', [...FC, '--previsualizar', '--json', '--bruto']));
  it('fa aprobada, con el padron', () => golden('fa-aprobada', [...FA, '--emitir', '--json']));
  it('fb aprobada', () => golden('fb-aprobada', [...FB, '--emitir', '--json']));
  it('rc aprobado', () => golden('rc-aprobado', ['rc', '-m', '1000', '--cs', '--cfinal', '--emitir', '--json']));

  it('fc observada: aprobada con observaciones y eventos', () => {
    sdk.wsfe.createVoucher.mockImplementation(
      wsfeAnswer('A', {
        events: [{ Code: 35, Msg: 'Se actualizaron los parametros de facturacion.' }],
        observations: [{ Code: 10217, Msg: 'El credito fiscal discriminado sera de uso exclusivo del receptor.' }],
      }),
    );

    return golden('fc-observada', [...FC, '--emitir', '--json']);
  });

  it('fc rechazada por ARCA: stdout y exit 2', () => {
    sdk.wsfe.createVoucher.mockImplementation(
      wsfeAnswer('R', {
        errors: [{ Code: 10016, Msg: 'El campo CbteFch no puede ser anterior a la fecha del ultimo comprobante.' }],
        observations: [{ Code: 10243, Msg: 'Condicion IVA receptor no valida.' }],
      }),
    );

    return golden('fc-rechazada', [...FC, '--emitir', '--json']);
  });

  it('fc rechazada con --bruto', () => {
    sdk.wsfe.createVoucher.mockImplementation(
      wsfeAnswer('R', { observations: [{ Code: 10243, Msg: 'Condicion IVA receptor no valida.' }] }),
    );

    return golden('fc-rechazada-bruto', [...FC, '--emitir', '--json', '--bruto']);
  });

  it('fc en dolares con la cotizacion de ARCA', () =>
    golden('fc-dolares', [...FC, '--mda', 'USD', '--previsualizar', '--json']));
  it('ncc vista previa con el asociado', () => golden('ncc-previsualizar', [...NCC, '--previsualizar', '--json']));
  it('ncc con el asociado sin verificar: aviso, no "ARCA no tiene" (ERR-1)', () => {
    sdk.generic.call.mockImplementation(failingQuery());
    sdk.wsfe.getSalesPoints.mockResolvedValue({
      resultGet: { ptoVenta: [{ bloqueado: 'N', emisionTipo: 'CAE', nro: 3 }] },
    });

    return golden('ncc-asociado-sin-verificar', [...NCC, '--previsualizar', '--json']);
  });
  it('ncc sobre un asociado de otro sistema, con un error que no es el 602 (REGLAS-1, ERR-1)', () => {
    sdk.generic.call.mockImplementation(failingQuery());
    sdk.wsfe.getSalesPoints.mockResolvedValue({
      resultGet: { ptoVenta: [{ bloqueado: 'N', emisionTipo: 'CAE', nro: 3 }] },
    });

    return golden('ncc-asociado-otro-sistema', [
      ...NCC.map((arg, index) => (NCC[index - 1] === '--apv' ? '50' : arg)),
      '--previsualizar',
      '--json',
    ]);
  });
  it('ncc por --cargar sobre un asociado de otro sistema, con un error que no es el 602', () => {
    sdk.generic.call.mockImplementation(failingQuery());
    sdk.wsfe.getSalesPoints.mockResolvedValue({
      resultGet: { ptoVenta: [{ bloqueado: 'N', emisionTipo: 'CAE', nro: 3 }] },
    });

    return golden('ncc-cargar-otro-sistema', [
      'ncc',
      '--cargar',
      writeInput('nota.json', {
        comprobanteAsociado: { atajo: 'fc', cuit: String(CUIT), numero: 12, puntoVenta: 50 },
        concepto: 'servicios',
        ivaReceptor: 'consumidor-final',
        montoTotal: 1000,
        tipoDocumento: 'consumidor-final',
      }),
      '--previsualizar',
      '--json',
    ]);
  });
  it('ncc aprobada', () => golden('ncc-aprobada', [...NCC, '--emitir', '--json']));

  it('nda aprobada', () =>
    golden('nda-aprobada', [
      ...['nda', '-m', '1210', '--cs', '--cuit', String(CLIENT_CUIT), '--ir-ri'],
      ...['--ac', 'fa', '--apv', '3', '--ar', '12', '--acuit', String(CUIT), '--emitir', '--json'],
    ]));

  it('el aviso del certificado por vencer va en avisos y en stderr', () =>
    golden('fc-certificado-por-vencer', [...FC, '--emitir', '--json'], { cert: certificate('2026-11-27') }));

  it('fc con --exportar-pdf sin el plugin: pdf.error, exit 0', () =>
    golden('fc-pdf-sin-plugin', [...FC, '--emitir', '--exportar-pdf', '--json']));
});

describe('FCE', () => {
  it('fcea vista previa', () => golden('fcea-previsualizar', [...FCEA, '--previsualizar', '--json']));
  it('fcea aprobada', () => golden('fcea-aprobada', [...FCEA, '--emitir', '--json']));

  it('ncea aprobada con el asociado', () => {
    sdk.generic.call.mockImplementation(
      consulting(issuedVoucher({ DocNro: CLIENT_CUIT, DocTipo: 80, ImpTotal: 5000000 })),
    );

    return golden('ncea-aprobada', [
      ...['ncea', '-m', '1000000', '--cs', '--cuit', String(CLIENT_CUIT), '--ir-ri'],
      ...['--ac', 'fcea', '--apv', '3', '--ar', '12', '--emitir', '--json'],
    ]);
  });
});

describe('lotes', () => {
  it('lote en vista previa: un array', () =>
    golden('lote-previsualizar', [
      'fc',
      '--cargar',
      writeInput('lote.json', [batchItem(1000), batchItem(2000)]),
      '--json',
    ]));

  it('lote emitido con --bruto', () =>
    golden('lote-aprobado-bruto', [
      ...[
        'fc',
        '--cargar',
        writeInput('lote.json', [batchItem(1000, { emitir: true }), batchItem(2000, { emitir: true })]),
      ],
      ...['--json', '--bruto'],
    ]));

  it('lote cortado: los emitidos en stdout y BATCH_EMISSION_ERROR en stderr', () => {
    sdk.wsfe.createVoucher.mockImplementationOnce(wsfeAnswer('A')).mockRejectedValueOnce(new Error('socket hang up'));

    return golden('lote-cortado', [
      ...['fc', '--cargar', writeInput('lote.json', [batchItem(1000), batchItem(2000), batchItem(3000)])],
      ...['--emitir', '--json'],
    ]);
  });

  it('lote cortado antes de emitir (ultimo numero)', () => {
    sdk.wsfe.getLastVoucher.mockResolvedValueOnce({ cbteNro: 41 }).mockRejectedValueOnce(new Error('ECONNRESET'));

    return golden('lote-cortado-antes-de-emitir', [
      ...['fc', '--cargar', writeInput('lote.json', [batchItem(1000), batchItem(2000)])],
      ...['--emitir', '--json'],
    ]);
  });

  it('lote con un rechazado: exit 2', () => {
    sdk.wsfe.createVoucher
      .mockImplementationOnce(wsfeAnswer('A'))
      .mockImplementationOnce(
        wsfeAnswer('R', { observations: [{ Code: 10243, Msg: 'Condicion IVA receptor no valida.' }] }),
      );

    return golden('lote-con-rechazado', [
      ...['fc', '--cargar', writeInput('lote.json', [batchItem(1000), batchItem(2000)])],
      ...['--emitir', '--json'],
    ]);
  });

  it('BATCH_VALIDATION_ERROR', () =>
    golden('error-batch-validation', [
      ...['fc', '--cargar', writeInput('lote.json', [batchItem(1000), batchItem(-5), { montoTotal: 10 }])],
      '--json',
    ]));
});

describe('ARCA contesta a la emisión algo que no se puede leer (ERR-16)', () => {
  const RC = ['rc', '-m', '1000', '--cs', '--cfinal'];
  const NCEA = [
    ...['ncea', '-m', '1000000', '--cs', '--cuit', String(CLIENT_CUIT), '--ir-ri'],
    ...['--ac', 'fcea', '--apv', '3', '--ar', '12'],
  ];
  const FE_APPROVABLE = [...FE, '--cuit-pais', '55000002126', '--pv', '4'];
  const CAUSE = 'ARCA contestó algo que ARCLI no pudo leer';
  const ONE = { Code: 1, Msg: 'x' };

  /** La respuesta aprobada, con estas claves en la raiz y en el detalle: sin el array que promete el WSDL. */
  function approvedWith(root: Record<string, unknown>, detail: Record<string, unknown> = {}) {
    return async (request: WsfeRequest) => {
      const answer = await wsfeAnswer('A')(request);
      const [first] = answer.response.FeDetResp.FECAEDetResponse;

      return {
        ...answer,
        response: { ...answer.response, ...root, FeDetResp: { FECAEDetResponse: [{ ...first, ...detail }] } },
      };
    };
  }

  const UNREADABLE: ReadonlyArray<readonly [string, (request: WsfeRequest) => Promise<unknown>]> = [
    ['sin respuesta', async () => undefined],
    ['null', async () => null],
    ['Errors.Err no es una lista', approvedWith({ Errors: { Err: ONE } })],
    ['Events.Evt no es una lista', approvedWith({ Events: { Evt: ONE } })],
    ['Observaciones.Obs no es una lista', approvedWith({}, { Observaciones: { Obs: ONE } })],
    ['una observación nula', approvedWith({}, { Observaciones: { Obs: [null] } })],
  ];

  async function uncertain(args: readonly string[]): Promise<Record<string, unknown>> {
    prepareConfig({});

    const result = await runCli([...args, '--emitir', '--json']);

    expect(result).toMatchObject({ code: 1, stdout: '' });

    return JSON.parse(result.stderr) as Record<string, unknown>;
  }

  it.each(UNREADABLE)('fc, %s: EMISSION_UNCERTAIN con el comando para verificar', async (_name, answer) => {
    sdk.wsfe.createVoucher.mockImplementation(answer);

    expect(await uncertain(FC)).toEqual({
      codigo: 'EMISSION_UNCERTAIN',
      detalles: { causa: CAUSE },
      error: `No se pudo confirmar la emisión: ${CAUSE}`,
      sugerencia: expect.stringContaining('`arcli ultimos fc --pv 3 --testing`'),
    });
    expect(sdk.wsfe.createVoucher).toHaveBeenCalledTimes(1);
  });

  it.each(UNREADABLE)('fc en la terminal, %s: el mismo error', async (_name, answer) => {
    sdk.wsfe.createVoucher.mockImplementation(answer);
    prepareConfig({});

    const result = await runCli([...FC, '--emitir']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('EMISIÓN SIN CONFIRMAR');
    expect(result.stderr.replace(/[│┃\s]+/g, ' ')).toContain('arcli ultimos fc --pv 3 --testing');
  });

  it.each<[string, string[]]>([
    ['fa', FA],
    ['fb', FB],
    ['fcea', FCEA],
    ['rc', RC],
    ['ncc', NCC],
    ['ncea', NCEA],
  ])('%s', async (shortcut, args) => {
    sdk.wsfe.createVoucher.mockResolvedValue(undefined);
    sdk.generic.call.mockImplementation(
      consulting(issuedVoucher(shortcut === 'ncea' ? { DocNro: CLIENT_CUIT, DocTipo: 80, ImpTotal: 5000000 } : {})),
    );

    expect(await uncertain(args)).toMatchObject({
      codigo: 'EMISSION_UNCERTAIN',
      detalles: { causa: CAUSE },
      sugerencia: expect.stringContaining(`\`arcli ultimos ${shortcut} --pv 3 --testing\``),
    });
  });

  it.each<[string, unknown]>([
    ['sin respuesta', undefined],
    ['null', null],
    ['Motivos_Obs no es texto', { FEXAuthorizeResult: { FEXResultAuth: { Motivos_Obs: ['x'], Resultado: 'A' } } }],
    ['Cae no es texto', { FEXAuthorizeResult: { FEXResultAuth: { Cae: 76463926585399, Resultado: 'A' } } }],
    ['ErrMsg no es texto', { FEXAuthorizeResult: { FEXErr: { ErrCode: 1, ErrMsg: ['x'] } } }],
    ['EventMsg no es texto', { FEXAuthorizeResult: { FEXEvents: { EventCode: 1, EventMsg: ['x'] } } }],
  ])('fe, %s: EMISSION_UNCERTAIN con su número y su solicitud', async (_name, answer) => {
    sdk.wsfex.authorize.mockResolvedValue(answer);

    expect(await uncertain(FE_APPROVABLE)).toEqual({
      codigo: 'EMISSION_UNCERTAIN',
      detalles: { causa: CAUSE, idSolicitud: 42, numero: 8 },
      error: `No se pudo confirmar la emisión: ${CAUSE}`,
      sugerencia: expect.stringContaining('`arcli consultar fe 8 --pv 4 --testing`'),
    });
    expect(sdk.wsfex.authorize).toHaveBeenCalledTimes(1);
  });

  it.each(['nce', 'nde'])('%s', async (shortcut) => {
    sdk.wsfex.authorize.mockResolvedValue(undefined);

    expect(await uncertain([shortcut, ...NCE.slice(1)])).toMatchObject({
      codigo: 'EMISSION_UNCERTAIN',
      detalles: { causa: CAUSE, idSolicitud: 42, numero: 8 },
      sugerencia: expect.stringContaining(`\`arcli consultar ${shortcut} 8 --pv 4 --testing\``),
    });
  });

  it('en un lote: sinConfirmar, corta y no reintenta', async () => {
    sdk.wsfe.createVoucher.mockImplementationOnce(wsfeAnswer('A')).mockResolvedValueOnce(undefined);

    await golden('lote-emision-ilegible', [
      ...['fc', '--cargar', writeInput('lote.json', [batchItem(1000), batchItem(2000), batchItem(3000)])],
      ...['--emitir', '--json'],
    ]);
    expect(sdk.wsfe.createVoucher).toHaveBeenCalledTimes(2);
  });

  it('fc: el error entero', () => {
    sdk.wsfe.createVoucher.mockResolvedValue(undefined);

    return golden('error-emision-ilegible', [...FC, '--emitir', '--json']);
  });

  it('fe: el error entero', () => {
    sdk.wsfex.authorize.mockResolvedValue(undefined);

    return golden('error-fe-emision-ilegible', [...FE_APPROVABLE, '--emitir', '--json']);
  });

  // Antes de la llamada que emite no es incierto: sale su error y, en un lote, sin `sinConfirmar`.
  it.each<[string, () => unknown]>([
    ['el último número', () => sdk.wsfe.getLastVoucher.mockRejectedValue(new Error('LoginFault'))],
    [
      'un error de ARCA por el último número',
      () => sdk.wsfe.getLastVoucher.mockResolvedValue({ errors: { err: [{ code: 600, msg: 'x' }] } }),
    ],
    ['el tope de numeración', () => sdk.wsfe.getLastVoucher.mockResolvedValue({ cbteNro: 99_999_999 })],
    ['un último número que no se puede leer', () => sdk.wsfe.getLastVoucher.mockResolvedValue(undefined)],
  ])('un lote cortado por %s no emitió y no trae sinConfirmar', async (_name, fail) => {
    fail();
    prepareConfig({});

    const result = await runCli([
      ...['fc', '--cargar', writeInput('lote.json', [batchItem(1000), batchItem(2000)]), '--emitir', '--json'],
    ]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      codigo: 'BATCH_EMISSION_ERROR',
      detalles: { fallo: 1, procesados: 0, sinProcesar: [1, 2], total: 2 },
    });
    expect(result.stderr).not.toContain('sinConfirmar');
    expect(sdk.wsfe.createVoucher).not.toHaveBeenCalled();
  });

  // Caracterización: una respuesta que se lee pero viene vacía o sin CAE sale como antes de ERR-16.
  it.each<[string, unknown, Record<string, unknown>, number]>([
    ['vacía', { cae: '', caeFchVto: '', response: {} }, { cae: null, estado: 'observado', resultado: null }, 0],
    [
      'aprobada sin CAE',
      { cae: '', caeFchVto: '', response: { FeDetResp: { FECAEDetResponse: [{ Resultado: 'A' }] } } },
      { cae: null, estado: 'aprobado', resultado: 'A' },
      0,
    ],
    [
      'con un error interno de ARCA y sin detalle',
      { cae: '', caeFchVto: '', response: { Errors: { Err: [{ Code: 501, Msg: 'Error interno de base de datos' }] } } },
      { cae: null, estado: 'rechazado', resultado: null },
      2,
    ],
  ])('sin cambios, fc con la respuesta %s', async (_name, answer, expected, code) => {
    sdk.wsfe.createVoucher.mockResolvedValue(answer);
    prepareConfig({});

    const result = await runCli([...FC, '--emitir', '--json']);

    expect(result.code).toBe(code);
    expect(JSON.parse(result.stdout)).toMatchObject(expected);
  });

  it.each<[string, unknown, Record<string, unknown>, number]>([
    ['vacía', {}, { cae: null, estado: 'observado', resultado: null }, 0],
    [
      'aprobada sin CAE',
      { FEXAuthorizeResult: { FEXResultAuth: { Resultado: 'A' } } },
      { cae: null, estado: 'aprobado', resultado: 'A' },
      0,
    ],
    [
      'con un error interno de ARCA y sin detalle',
      { FEXAuthorizeResult: { FEXErr: { ErrCode: 500, ErrMsg: 'Error interno' } } },
      { cae: null, estado: 'rechazado', resultado: null },
      2,
    ],
  ])('sin cambios, fe con la respuesta %s', async (_name, answer, expected, code) => {
    sdk.wsfex.authorize.mockResolvedValue(answer);
    prepareConfig({});

    const result = await runCli([...FE_APPROVABLE, '--emitir', '--json']);

    expect(result.code).toBe(code);
    expect(JSON.parse(result.stdout)).toMatchObject(expected);
  });
});

describe('consumidor final sin numero (REV-63)', () => {
  // Sin flag de receptor, el IVA receptor sale de la config; el documento, consumidor final por defecto.
  const setup: Setup = { config: { ivaReceptorPorDefecto: 'consumidor-final' } };

  /** La `solicitud` del `--json` de un comprobante suelto en vista previa. */
  async function previewRequest(args: readonly string[]): Promise<Record<string, unknown>> {
    prepareConfig(setup);

    const result = await runCli([...args, '--previsualizar', '--json']);

    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);

    return (JSON.parse(result.stdout) as { solicitud: Record<string, unknown> }).solicitud;
  }

  it('--cfinal manda DocNro 0, como siempre', async () => {
    expect(await previewRequest(['fc', '-m', '1000', '--cs', '--cfinal'])).toMatchObject({ DocNro: 0, DocTipo: 99 });
  });

  it('sin flag de receptor: la misma solicitud que con --cfinal', async () => {
    const withFlag = await previewRequest(['fc', '-m', '1000', '--cs', '--cfinal']);
    const implicit = await previewRequest(['fc', '-m', '1000', '--cs']);

    expect(implicit).toMatchObject({ DocNro: 0, DocTipo: 99 });
    expect(implicit).toEqual(withFlag);
  });

  it('--cargar con tipoDocumento consumidor-final sin numero: la misma solicitud que con --cfinal', async () => {
    const withFlag = await previewRequest(['fc', '-m', '1000', '--cs', '--cfinal']);
    const loaded = await previewRequest(['fc', '--cargar', writeInput('fc.json', batchItem(1000))]);

    expect(loaded).toMatchObject({ DocNro: 0, DocTipo: 99 });
    expect(loaded).toEqual(withFlag);
  });

  it('la vista previa sin flag de receptor dice Consumidor final, no N/D', async () => {
    prepareConfig(setup);

    const result = await runCli(['fc', '-m', '1000', '--cs', '--previsualizar']);

    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Consumidor final');
    expect(result.stdout).not.toContain('N/D');
  });
});

describe('errores de facturacion (stderr, exit 1)', () => {
  it('INPUT_VALIDATION_ERROR de un flag', () => golden('error-input-flag', ['fc', '--monto', 'abc', '--json']));
  it('INPUT_VALIDATION_ERROR de uso (opcion desconocida)', () =>
    golden('error-input-uso', ['fc', '--montoo', '1', '--json']));
  it('INPUT_VALIDATION_ERROR sin monto', () => golden('error-input-sin-monto', ['fc', '--cs', '--cfinal', '--json']));

  it('INPUT_VALIDATION_ERROR de --cargar con una clave desconocida', () =>
    golden('error-input-cargar', [
      'fc',
      '--cargar',
      writeInput('fc.json', batchItem(1000, { montototal: 1 })),
      '--json',
    ]));

  it('INPUT_VALIDATION_ERROR: NC mayor que su factura', () => {
    sdk.generic.call.mockImplementation(consulting(issuedVoucher({ ImpTotal: 800 })));

    return golden('error-input-nc-mayor', [...NCC, '--previsualizar', '--json']);
  });

  it('CONFIGURATION_ERROR sin CUIT', () =>
    golden('error-configuracion-sin-cuit', [...FC, '--previsualizar', '--json'], { config: { cuit: undefined } }));

  it('CONFIGURATION_ERROR con config.json roto', () =>
    golden('error-configuracion-json-roto', [...FC, '--previsualizar', '--json'], { rawConfig: '{roto' }));

  it('CERTIFICATE_EXPIRED', () =>
    golden('error-certificado-vencido', [...FC, '--emitir', '--json'], { cert: certificate('2026-11-01') }));

  it('EMISSION_UNCERTAIN', () => {
    sdk.wsfe.createVoucher.mockRejectedValue(new Error('socket hang up'));

    return golden('error-emision-sin-confirmar', [...FC, '--emitir', '--json']);
  });

  it('TRANSIENT_ERROR', () => {
    sdk.wsfe.getLastVoucher.mockRejectedValue(new Error('ns1:coe.alreadyAuthenticated'));

    return golden('error-transitorio', [...FC, '--emitir', '--json']);
  });

  it('UNEXPECTED_ERROR', () => {
    sdk.wsfe.getLastVoucher.mockRejectedValue(new Error('getaddrinfo ENOTFOUND wswhomo.afip.gov.ar'));

    return golden('error-inesperado', [...FC, '--emitir', '--json']);
  });

  it('ARCA_LAST_VOUCHER_ERROR', () => {
    sdk.wsfe.getLastVoucher.mockResolvedValue({
      errors: { err: [{ code: 11002, msg: 'El punto de venta no se encuentra habilitado a usar el presente WS.' }] },
    });

    return golden('error-ultimo-numero', [...FC, '--emitir', '--json']);
  });

  it('ARCA_QUOTATION_ERROR', () => {
    sdk.wsfe.getQuotation.mockResolvedValue({
      errors: { err: [{ code: 600, msg: 'ValidacionDeToken: No aparecio CUIT.' }] },
    });

    return golden('error-cotizacion', [...FC, '--mda', 'USD', '--previsualizar', '--json']);
  });

  it('WSFE_SERVICE_NOT_AUTHORIZED', () => {
    sdk.wsfe.getLastVoucher.mockRejectedValue(new Error('ns1:cms.cert.notAuthorized'));

    return golden('error-wsfe-no-autorizado', [...FC, '--emitir', '--json']);
  });

  it('el padron sin autorizar no corta: aviso', () => {
    sdk.padron.getTaxpayerDetails.mockRejectedValue(new Error('ns1:cms.cert.notAuthorized'));

    return golden(
      'fa-padron-no-autorizado',
      ['fa', '-m', '12100', '--cs', '--cuit', String(CLIENT_CUIT), '--previsualizar', '--json'],
      { config: { ivaReceptorPorDefecto: 'responsable-inscripto' } },
    );
  });
});

describe('factura E y sus notas', () => {
  it('fe vista previa', () => golden('fe-previsualizar', [...FE, '--previsualizar', '--json']));
  it('fe aprobada', () => golden('fe-aprobada', [...FE, '--emitir', '--json']));
  it('fe aprobada con --bruto', () => golden('fe-aprobada-bruto', [...FE, '--emitir', '--json', '--bruto']));
  it('fe vista previa con --bruto', () =>
    golden('fe-previsualizar-bruto', [...FE, '--previsualizar', '--json', '--bruto']));

  it('fe rechazada: exit 2', () => {
    sdk.wsfex.authorize.mockImplementation(wsfexAnswer('R'));

    return golden('fe-rechazada', [...FE, '--emitir', '--json']);
  });

  it('fe rechazada con FEXErr y FEXEvents', () => {
    sdk.wsfex.authorize.mockImplementation(async (input: Parameters<ReturnType<typeof wsfexAnswer>>[0]) => {
      const answer = await wsfexAnswer('R')(input);

      return {
        FEXAuthorizeResult: {
          ...answer.FEXAuthorizeResult,
          FEXErr: { ErrCode: 1601, ErrMsg: 'El campo Fecha_cbte no es valido.' },
          FEXEvents: { EventCode: 1, EventMsg: 'Se actualizaron las tablas de WSFEX.' },
        },
      };
    });

    return golden('fe-rechazada-errores-eventos', [...FE, '--emitir', '--json']);
  });

  it('factura e con un flag de A, B y C: aviso', () =>
    golden('factura-e-flag-salteado', [
      'factura',
      'e',
      ...FE.slice(1),
      '--alicuota',
      '21',
      '--previsualizar',
      '--json',
    ]));

  it('fe de bienes con permiso de embarque verificado', () =>
    golden('fe-bienes-permiso', [...FE_GOODS, '--previsualizar', '--json']));

  it('fe de bienes con un permiso que ARCA no pudo verificar: aviso', () => {
    sdk.wsfex.checkPermiso.mockRejectedValue(new Error('socket hang up'));

    return golden('fe-bienes-permiso-sin-verificar', [...FE_GOODS, '--previsualizar', '--json']);
  });

  it('nce vista previa', () => golden('nce-previsualizar', [...NCE, '--previsualizar', '--json']));
  it('nce aprobada', () => golden('nce-aprobada', [...NCE, '--emitir', '--json']));
  it('nde aprobada', () =>
    golden('nde-aprobada', ['nde', '-m', '200', '--ar', '1', '--apv', '4', '--pv', '4', '--emitir', '--json']));

  it('INPUT_VALIDATION_ERROR: --cargar con un array', () =>
    golden('error-fe-lote', ['fe', '--cargar', writeInput('lote.json', [{ montoTotal: 1 }]), '--json']));

  it('INPUT_VALIDATION_ERROR: actividad fuera de la tabla', () =>
    golden('error-fe-actividad', [...FE, '--actividad', '620900', '--previsualizar', '--json']));

  it('INPUT_VALIDATION_ERROR: permiso de embarque que ARCA no reconoce', () => {
    sdk.wsfex.checkPermiso.mockResolvedValue({
      FEXCheck_PermisoResult: { ...NO_FEX_ERROR, FEXResultGet: { Status: 'NO' } },
    });

    return golden('error-fe-permiso-invalido', [...FE_GOODS, '--emitir', '--json']);
  });

  it('EMISSION_UNCERTAIN con numero e ID de solicitud', () => {
    sdk.wsfex.authorize.mockRejectedValue(new Error('socket hang up'));

    return golden('error-fe-emision-sin-confirmar', [...FE, '--emitir', '--json']);
  });

  it('WSFEX_SERVICE_NOT_AUTHORIZED', () => {
    sdk.wsfex.getParamActividades.mockRejectedValue(new Error('ns1:cms.cert.notAuthorized'));

    return golden('error-wsfex-no-autorizado', [...FE, '--previsualizar', '--json']);
  });

  it('ARCA_EXPORT_ERROR', () => {
    sdk.wsfex.getLastId.mockResolvedValue({
      FEXGetLast_IDResult: { FEXErr: { ErrCode: 1000, ErrMsg: 'Error interno de la aplicacion.' } },
    });

    return golden('error-fe-arca', [...FE, '--previsualizar', '--json']);
  });

  it('ARCA_QUOTATION_ERROR sin cotizacion de aduana', () => {
    sdk.wsfex.getParamMonConCotizacion.mockResolvedValue({
      FEXGetPARAM_MON_CON_COTIZACIONResult: {
        ...NO_FEX_ERROR,
        FEXResultGet: { ClsFEXResponse_Mon_CON_Cotizacion: [] },
      },
    });

    return golden('error-fe-cotizacion', [...FE, '--previsualizar', '--json']);
  });

  it('CERTIFICATE_EXPIRED', () =>
    golden('error-fe-certificado-vencido', [...FE, '--previsualizar', '--json'], { cert: certificate('2026-11-01') }));
});

describe('otros comandos que van a ARCA', () => {
  it('VOUCHER_NOT_FOUND', () => {
    sdk.generic.call.mockImplementation(consulting(null));

    return golden('error-consultar-no-existe', ['consultar', 'fc', '99', '--json']);
  });

  it('ARCA_VOUCHER_QUERY_ERROR en consultar (ERR-1)', () => {
    sdk.generic.call.mockImplementation(failingQuery());

    return golden('error-consultar-arca', ['consultar', 'fc', '99', '--json']);
  });

  it('ARCA_VOUCHER_QUERY_ERROR en ultimos: falla uno del medio y falla el comando', () => {
    sdk.generic.call.mockImplementation(failingQuery([40]));

    return golden('error-ultimos-comprobante', ['ultimos', 'fc', '--cantidad', '3', '--json']);
  });

  it('ultimos saltea un 602 del medio', () => {
    sdk.generic.call.mockImplementation(
      async (service: string, method: string, params: { FeCompConsReq: { CbteNro: number } }) =>
        consulting(params.FeCompConsReq.CbteNro === 40 ? null : issuedVoucher())(service, method),
    );

    return golden('ultimos-con-hueco', ['ultimos', 'fc', '--cantidad', '3', '--json']);
  });

  it('consultar con un error transitorio sigue siendo TRANSIENT_ERROR', () => {
    sdk.generic.call.mockRejectedValue(new Error('ns1:coe.alreadyAuthenticated'));

    return golden('error-consultar-transitorio', ['consultar', 'fc', '99', '--json']);
  });

  it('consultar con una excepción que dice "no existe" es UNEXPECTED_ERROR (ERR-1)', () => {
    sdk.generic.call.mockRejectedValue(new Error('El dominio no existe'));

    return golden('error-consultar-excepcion', ['consultar', 'fc', '99', '--json']);
  });

  it('consultar sin autorizar sigue siendo WSFE_SERVICE_NOT_AUTHORIZED', () => {
    sdk.generic.call.mockRejectedValue(new Error('ns1:cms.cert.notAuthorized'));

    return golden('error-consultar-no-autorizado', ['consultar', 'fc', '99', '--json']);
  });

  it('consultar una NC A con asociado, período, vencimiento, misma moneda y opcionales (SDK-13)', () => {
    sdk.generic.call.mockImplementation(
      consulting(
        issuedVoucher({
          CanMisMonExt: 'S',
          CbteFch: '20261115',
          CbtesAsoc: { CbteAsoc: [{ CbteFch: '20261110', Cuit: String(CUIT), Nro: 12, PtoVta: 3, Tipo: 1 }] },
          CondicionIVAReceptorId: 1,
          DocNro: CLIENT_CUIT,
          DocTipo: 80,
          FchServDesde: '20261001',
          FchServHasta: '20261031',
          FchVtoPago: '20261125',
          ImpIVA: 21,
          ImpNeto: 100,
          ImpTotal: 156,
          ImpTrib: 35,
          Iva: { AlicIva: [{ BaseImp: 100, Id: 5, Importe: 21 }] },
          MonCotiz: 1452.5,
          MonId: 'DOL',
          Observaciones: {
            Obs: [{ Code: 10217, Msg: 'El credito fiscal discriminado sera de uso exclusivo del receptor.' }],
          },
          Opcionales: { Opcional: [{ Id: '22', Valor: 'N' }] },
          Tributos: { Tributo: [{ Alic: 35, BaseImp: 100, Desc: 'Percepción IIBB', Id: 2, Importe: 35 }] },
        }),
      ),
    );

    return golden('consultar-nca', ['consultar', 'nca', '13', '--json']);
  });

  it('ARCA_LAST_VOUCHER_ERROR en ultimos', () => {
    sdk.wsfe.getLastVoucher.mockResolvedValue({
      errors: { err: [{ code: 11002, msg: 'Punto de venta no habilitado.' }] },
    });

    return golden('error-ultimos', ['ultimos', 'fc', '--json']);
  });

  it('padron de un responsable inscripto', () => golden('padron', ['padron', String(CLIENT_CUIT), '--json']));

  it('padron de un monotributista, con la letra y el periodo de la categoria', () => {
    // Recortado de la respuesta real de ARCA testing para 20333333334 (17/11/2026).
    sdk.padron.getTaxpayerDetails.mockResolvedValue({
      datosGenerales: {
        apellido: 'PEREZ TEST',
        domicilioFiscal: { codPostal: '1406', direccion: 'MARTINEZ VICTOR 423' },
        estadoClave: 'ACTIVO',
        nombre: 'JUAN',
        tipoPersona: 'FISICA',
      },
      datosMonotributo: {
        actividadMonotributista: { descripcionActividad: 'CULTIVO DE FRUTAS DE CAROZO', idActividad: 12320 },
        categoriaMonotributo: {
          descripcionCategoria: 'E VENTAS DE COSAS MUEBLES',
          idCategoria: 47,
          idImpuesto: 20,
          periodo: 201309,
        },
        impuesto: [{ descripcionImpuesto: 'MONOTRIBUTO', estadoImpuesto: 'AC', idImpuesto: 20, periodo: 201309 }],
      },
    });

    return golden('padron-monotributista', ['padron', '20333333334', '--json']);
  });

  it('TAXPAYER_NOT_FOUND', () => {
    sdk.padron.getTaxpayerDetails.mockResolvedValue(null);

    return golden('error-padron-no-existe', ['padron', String(CLIENT_CUIT), '--json']);
  });

  it('PADRON_SERVICE_NOT_AUTHORIZED', () => {
    sdk.padron.getTaxpayerDetails.mockRejectedValue(new Error('ns1:cms.cert.notAuthorized'));

    return golden('error-padron-no-autorizado', ['padron', String(CLIENT_CUIT), '--json']);
  });

  it('FCE_SERVICE_NOT_AUTHORIZED', () => {
    sdk.wsfecred.consultarMontoObligadoRecepcion.mockRejectedValue(new Error('ns1:cms.cert.notAuthorized'));

    return golden('error-fce-no-autorizado', ['fce-obligado', String(CLIENT_CUIT), '--json']);
  });

  it('FCE_OBLIGATION_ERROR', () => {
    sdk.wsfecred.consultarMontoObligadoRecepcion.mockResolvedValue({
      consultarMontoObligadoRecepcionReturn: {
        arrayErrores: { codigoDescripcion: [{ codigo: 1101, descripcion: 'El CUIT consultado no es valido.' }] },
      },
    });

    return golden('error-fce-obligacion', ['fce-obligado', String(CLIENT_CUIT), '--json']);
  });

  it('ARCA_UNAVAILABLE', () => {
    sdk.wsfe.getServerStatus.mockRejectedValue(new Error('connect ETIMEDOUT'));

    return golden('error-estado', ['estado', '--json']);
  });

  it('ARCA_PARAMETERS_ERROR', () => {
    sdk.wsfe.getVoucherTypes.mockResolvedValue({
      errors: { err: [{ code: 600, msg: 'ValidacionDeToken: No aparecio CUIT.' }] },
    });

    return golden('error-parametros', ['parametros', 'comprobantes', '--json']);
  });

  it('ARCA_QUOTATION_ERROR en parametros cotizacion', () => {
    sdk.wsfe.getQuotation.mockResolvedValue({
      errors: { err: [{ code: 600, msg: 'ValidacionDeToken: No aparecio CUIT.' }] },
    });

    return golden('error-parametros-cotizacion', ['parametros', 'cotizacion', 'USD', '--json']);
  });
});

describe('monotributo', () => {
  // La pagina real de ARCA (valores desde el 1/08/2026), sin red.
  const PAGE = readFileSync(
    new URL('../../modules/monotributo/__tests__/fixtures/categorias.html', import.meta.url),
    'utf8',
  );

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(PAGE)),
    );
    // El CUIT de la config es monotributista, categoria E.
    sdk.padron.getTaxpayerDetails.mockResolvedValue({
      datosGenerales: { apellido: 'PEREZ', estadoClave: 'ACTIVO', nombre: 'JUAN', tipoPersona: 'FISICA' },
      datosMonotributo: {
        categoriaMonotributo: { descripcionCategoria: 'E LOCACIONES DE SERVICIO', idCategoria: 47, periodo: 202602 },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('la tabla leída de ARCA, con la categoría del padrón', () => golden('monotributo', ['monotributo', '--json']));

  it('una categoría', () => golden('monotributo-categoria', ['monotributo', '--categoria', 'k', '--json']));

  it('INPUT_VALIDATION_ERROR: una letra que no es categoría', () =>
    golden('error-monotributo-categoria', ['monotributo', '--categoria', 'Z', '--json']));
});

describe('json en la config, sin --json', () => {
  const JSON_DEFAULT = { output: { brutoPorDefecto: false, emitirPorDefecto: false, jsonPorDefecto: true } };

  it('el resultado sale en JSON', () =>
    golden('config-json-resultado', [...FC, '--previsualizar'], { config: JSON_DEFAULT }));

  it('el error sale en JSON', () => golden('config-json-error', ['fc', '--monto', 'abc'], { config: JSON_DEFAULT }));
});

describe('certificado (CERTIFICATE_*)', () => {
  function writeCertificate(name: string, pem: string): string {
    const path = join(configDir, name);

    writeFileSync(path, pem);

    return path;
  }

  it('CERTIFICATE_REQUEST_PENDING', async () => {
    prepareConfig({});
    await runCli(['certificado', 'generar', '--testing', '--json']);
    process.exitCode = undefined;

    await golden('error-certificado-pedido-pendiente', ['certificado', 'generar', '--testing', '--json']);
  });

  it('CERTIFICATE_INVALID', () =>
    golden('error-certificado-invalido', [
      'certificado',
      'importar',
      writeCertificate('roto.crt', 'no es un certificado'),
      '--json',
    ]));

  it('CERTIFICATE_CUIT_MISMATCH', () =>
    golden('error-certificado-otro-cuit', [
      ...['certificado', 'importar', writeCertificate('otro.crt', certificate('2027-11-17', { cuit: CLIENT_CUIT }))],
      '--json',
    ]));

  it('CERTIFICATE_EXPIRED al importar', () =>
    golden('error-certificado-importar-vencido', [
      ...['certificado', 'importar', writeCertificate('vencido.crt', certificate('2026-11-01'))],
      '--json',
    ]));

  it('CERTIFICATE_ENVIRONMENT_UNKNOWN', () =>
    golden('error-certificado-emisor-desconocido', [
      ...['certificado', 'importar', writeCertificate('otro.crt', certificate('2027-11-17', { issuer: 'Otra CA' }))],
      '--json',
    ]));

  it('CERTIFICATE_KEY_MISMATCH', () =>
    golden('error-certificado-otra-clave', [
      ...['certificado', 'importar', writeCertificate('otro.crt', certificate('2027-11-17', { otherKey: true }))],
      '--json',
    ]));

  it('CERTIFICATE_REPLACE_CONFIRMATION', () =>
    golden('error-certificado-reemplazar', [
      ...['certificado', 'importar', writeCertificate('nuevo.crt', certificate('2028-01-17'))],
      '--json',
    ]));
});
