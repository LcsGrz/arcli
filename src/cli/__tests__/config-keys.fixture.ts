import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, vi } from 'vitest';

import { type ConfigPublicKey, configPublicKeySchema } from '../../modules/config/config.schemas';
import { ConfigService } from '../../modules/config/config.service';
import { reportCliError, shouldPrintErrorAsJson } from '../error-output';
import { createProgram } from '../program';

/**
 * Lo comun de los tests de caracterizacion de la config (REV-37): una carpeta por test con archivos ficticios, un
 * valor para cada clave y la salida sin nada que dependa del equipo.
 */

export const CONFIG_KEYS = configPublicKeySchema.options;

const CBU = '0110599520000012345678';
const ALIAS = 'mi.alias.cbu';

const pem = (kind: string) => `-----BEGIN ${kind}-----\nficticio\n-----END ${kind}-----\n`;

const FILES: Readonly<Record<string, string>> = {
  'cert-produccion.pem': pem('CERTIFICATE'),
  'cert-testing.pem': pem('CERTIFICATE'),
  'cifrada.pem': pem('ENCRYPTED PRIVATE KEY'),
  'expo-cert-produccion.pem': pem('CERTIFICATE'),
  'expo-cert-testing.pem': pem('CERTIFICATE'),
  'expo-key-produccion.pem': pem('PRIVATE KEY'),
  'expo-key-testing.pem': pem('PRIVATE KEY'),
  'key-produccion.pem': pem('PRIVATE KEY'),
  'key-testing.pem': pem('PRIVATE KEY'),
  'logo.gif': 'ficticio',
  'logo.png': 'ficticio',
  navegador: 'ficticio',
  'sin-pem.txt': 'ficticio',
};

/** `@archivo` es ese archivo en la carpeta del test. Una clave nueva no compila sin su valor. */
const FULL_VALUES: Readonly<Record<ConfigPublicKey, readonly [value: string, alias?: string]>> = {
  alicuota: ['10,5'],
  bruto: ['si'],
  'cert.produccion': ['@cert-produccion.pem'],
  'cert.testing': ['@cert-testing.pem'],
  concepto: ['productos-servicios'],
  condicionVenta: ['a 45 días'],
  consultarPadron: ['no'],
  cotizacion: ['1.350,5'],
  cuenta: [CBU, ALIAS],
  cuit: ['20-12345678-6'],
  'emisor.condicionIva': ['responsable-inscripto'],
  'emisor.domicilio': ['Calle Ficticia 123'],
  'emisor.iibb': ['901-123456-7'],
  'emisor.inicioActividades': ['1/03/2020'],
  'emisor.logo': ['@logo.png'],
  'emisor.razonSocial': ['Ana Ficticia'],
  emitir: ['si'],
  entorno: ['produccion'],
  'exportacion.actividad': ['620100'],
  'exportacion.cert.produccion': ['@expo-cert-produccion.pem'],
  'exportacion.cert.testing': ['@expo-cert-testing.pem'],
  'exportacion.key.produccion': ['@expo-key-produccion.pem'],
  'exportacion.key.testing': ['@expo-key-testing.pem'],
  filasPorLista: ['20'],
  ivaReceptor: ['consumidor-final'],
  json: ['si'],
  'key.produccion': ['@key-produccion.pem'],
  'key.testing': ['@key-testing.pem'],
  moneda: ['usd'],
  'monotributo.tope': ['30.000.000'],
  pdf: ['siempre'],
  pdfCarpeta: ['@pdfs'],
  pdfNavegador: ['@navegador'],
  puntoVenta: ['3'],
  ticketPath: ['@tickets-propios'],
  verificarFce: ['si'],
};

/** Claves que `config establecer` acepta deprecadas. */
const DEPRECATED_VALUES: Readonly<Record<string, readonly [value: string, alias?: string]>> = {
  aliasCbu: [ALIAS],
  cbu: [CBU],
  comprobantesPorLista: ['12'],
};

/** Todas, en el orden del contrato y con las deprecadas al final. */
export const KEYS_AND_DEPRECATED: readonly string[] = [...CONFIG_KEYS, ...Object.keys(DEPRECATED_VALUES)];

let directory = '';

export const configPath = () => join(directory, 'config.json');

/** La carpeta del test tal cual, para afirmar que no sale en ningun lado. */
export const testFolder = () => directory;

/** `@archivo` en la carpeta del test. */
export function withFiles(value: string): string {
  return value.startsWith('@') ? join(directory, value.slice(1)) : value;
}

/** Lo que se le pasa a `config establecer <clave>`, con las rutas de este test. */
export function fullValue(key: string): readonly [value: string, alias?: string] {
  const [value, alias] = DEPRECATED_VALUES[key] ?? FULL_VALUES[key as ConfigPublicKey];

  return alias === undefined ? [withFiles(value)] : [withFiles(value), alias];
}

export function withConfigService<T>(run: (service: ConfigService) => T): T {
  const service = new ConfigService();

  try {
    return run(service);
  } finally {
    service.close();
  }
}

/** Deja guardadas todas las claves menos `except`. */
export function saveFullConfig(except: readonly ConfigPublicKey[] = []): void {
  withConfigService((service) => {
    service.changeValues({
      remove: [],
      set: CONFIG_KEYS.filter((key) => key !== 'cuenta' && !except.includes(key)).map(
        (key) => [key, fullValue(key)[0]] as const,
      ),
    });
    service.setValue('cuenta', ...fullValue('cuenta'));
  });
}

/** Un config.json como lo dejaba la 2.0, sin las claves nuevas y con `comprobantesPorLista`. */
export function saveOldConfig(): void {
  const config = {
    alicuotaPorDefecto: '21',
    cbu: CBU,
    comprobantesPorLista: 8,
    conceptoPorDefecto: 'servicios',
    cotizacionPorDefecto: 1200.25,
    cuit: '20111111112',
    entornoPorDefecto: 'testing',
    ivaReceptorPorDefecto: 'responsable-monotributo',
    monedaPorDefecto: 'dol',
    output: { emitirPorDefecto: false, jsonPorDefecto: false },
    puntoVentaPorDefecto: 7,
  };

  writeFileSync(configPath(), JSON.stringify(config, null, '\t'));
}

export const storedBytes = () => readFileSync(configPath(), 'utf8');

/** Registra los hooks: una carpeta de config nueva por test, con sus archivos ficticios. */
export function useConfigKeysFixture(): void {
  // Escriben el config.json muchas veces por test: en Windows tarda varias veces más.
  vi.setConfig({ testTimeout: 30_000 });

  beforeEach(() => {
    // Con nombre fijo adentro de la temporal: la mascara deja `.../config/archivo`.
    directory = join(mkdtempSync(join(tmpdir(), 'arcli-claves-')), 'config');
    mkdirSync(directory);

    for (const [name, content] of Object.entries(FILES)) {
      writeFileSync(join(directory, name), content);
    }

    vi.stubEnv('ARCLI_CONFIG_DIR', directory);
    vi.stubEnv('NO_COLOR', '1');
    vi.stubEnv('FORCE_HYPERLINK', '0');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = undefined;
    rmSync(dirname(directory), { force: true, recursive: true });
  });
}

/** El comando entero, como `index.ts`, sin terminal: los paneles no dependen del ancho de quien corre la suite. */
export async function runCli(...args: readonly string[]): Promise<{ code: number; stderr: string; stdout: string }> {
  let stdout = '';
  let stderr = '';
  const spies = [
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);

      return true;
    }),
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);

      return true;
    }),
  ];
  const argv = ['node', 'arcli', ...args];
  const columns = [process.stdout.columns, process.stderr.columns] as const;

  process.stdout.columns = 0;
  process.stderr.columns = 0;
  process.exitCode = undefined;

  try {
    await createProgram().parseAsync(argv);
  } catch (error) {
    process.exitCode = reportCliError(error, shouldPrintErrorAsJson(argv));
  } finally {
    [process.stdout.columns, process.stderr.columns] = columns;
    spies.forEach((spy) => spy.mockRestore());
  }

  return { code: Number(process.exitCode ?? 0), stderr, stdout };
}

/**
 * La salida igual en cualquier equipo: la carpeta del test es `<config>`; la del usuario, `<home>`, y la actual,
 * `<cwd>`, con `/` (en Windows, `\`, o `\\` dentro de un JSON).
 */
export function normalize(text: string): string {
  const folders = [
    ['<config>', directory],
    ['<home>', homedir()],
    ['<cwd>', process.cwd()],
  ] as const;

  // Una ruta relativa, ya enmascarada, queda con el nombre de la carpeta actual.
  const masked = text.replaceAll(`.../${basename(process.cwd())}/`, '.../<cwd>/');

  return folders.reduce((result, [name, folder]) => {
    const paths = [...new Set([realpathSync(folder), realpathSync.native(folder), folder])];
    const forms = paths.flatMap((path) => [
      [pathToFileURL(path).href, `file://${name}`],
      [path.replaceAll('\\', '\\\\'), name],
      [path, name],
    ]);

    return forms
      .reduce((current, [form, replacement]) => current.split(form).join(replacement), result)
      .replace(new RegExp(`${name}(?:\\\\{1,2}[\\w.-]+)+`, 'g'), (match) => match.replace(/\\{1,2}/g, '/'));
  }, masked);
}
