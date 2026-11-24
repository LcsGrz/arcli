import Conf from 'conf';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { ConfigurationError, InputIssuesError, InputValidationError } from '../../lib/errors/app-error';
import { parseCbu } from '../../lib/identity/cbu';
import { describeZodIssues, parseZodInput } from '../billing/billing.zod-errors';

import {
  type ArcliConfig,
  arcliConfigSchema,
  CONFIG_DEFAULTS,
  type ConfigPublicKey,
  configPublicKeySchema,
  ROWS_PER_LIST_DEPRECATION_WARNING,
} from './config.schemas';
import { type CanonicalConfigKey, parseConfigValue } from './config-value-parser';

const CONFIG_KEY_ALIASES: Record<ConfigPublicKey, CanonicalConfigKey> = {
  alicuota: 'alicuotaPorDefecto',
  aliasCbu: 'aliasCbu',
  cbu: 'cbu',
  'cert.produccion': 'cert.produccion',
  'cert.testing': 'cert.testing',
  concepto: 'conceptoPorDefecto',
  condicionVenta: 'condicionVenta',
  cotizacion: 'cotizacionPorDefecto',
  cuit: 'cuit',
  'emisor.condicionIva': 'emisor.condicionIva',
  'emisor.domicilio': 'emisor.domicilio',
  'emisor.iibb': 'emisor.iibb',
  'emisor.inicioActividades': 'emisor.inicioActividades',
  'emisor.logo': 'emisor.logo',
  'emisor.razonSocial': 'emisor.razonSocial',
  entorno: 'entornoPorDefecto',
  emitir: 'output.emitirPorDefecto',
  'exportacion.actividad': 'exportacion.actividad',
  'exportacion.cert.produccion': 'exportacion.cert.produccion',
  'exportacion.cert.testing': 'exportacion.cert.testing',
  'exportacion.key.produccion': 'exportacion.key.produccion',
  'exportacion.key.testing': 'exportacion.key.testing',
  filasPorLista: 'filasPorLista',
  ivaReceptor: 'ivaReceptorPorDefecto',
  json: 'output.jsonPorDefecto',
  'key.produccion': 'key.produccion',
  'key.testing': 'key.testing',
  moneda: 'monedaPorDefecto',
  'monotributo.tope': 'monotributo.tope',
  bruto: 'output.brutoPorDefecto',
  pdf: 'pdf',
  pdfCarpeta: 'pdfCarpeta',
  pdfNavegador: 'pdfNavegador',
  puntoVenta: 'puntoVentaPorDefecto',
  ticketPath: 'ticketPath',
  verificarFce: 'verificarFce',
  consultarPadron: 'consultarPadron',
};

/**
 * Claves deprecadas que `config establecer` y `config eliminar` todavia aceptan, con la clave que las reemplaza. No
 * son claves publicas: no salen en la ayuda, el autocompletado ni `arcli config`. Se sacan en la 3.0.0.
 *
 * @internal Exportado para los tests.
 */
export const DEPRECATED_CONFIG_KEYS: Readonly<
  Record<string, { readonly replacement: ConfigPublicKey; readonly warning: string }>
> = {
  comprobantesPorLista: { replacement: 'filasPorLista', warning: ROWS_PER_LIST_DEPRECATION_WARNING },
};

/**
 * Claves guardadas que se borran al cambiar o borrar la clave publica: la deprecada no puede quedar en el archivo
 * con otro valor, porque se seguiria leyendo si se borra la nueva.
 */
const LEGACY_STORED_KEYS: Partial<Record<ConfigPublicKey, readonly string[]>> = {
  filasPorLista: ['comprobantesPorLista'],
};

/** El aviso de una clave deprecada (`comprobantesPorLista`), para mostrarlo al guardarla o borrarla. */
export function deprecatedConfigKeyWarning(rawKey: string): string | undefined {
  const key = rawKey.trim();

  return Object.hasOwn(DEPRECATED_CONFIG_KEYS, key) ? DEPRECATED_CONFIG_KEYS[key].warning : undefined;
}

/** Donde ver las claves y sus valores, si el rechazo no trae una sugerencia propia. */
const CONFIG_SET_HELP_SUGGESTION =
  'Mirá cada clave con sus valores válidos en `arcli config establecer --ayuda`, y la config actual con `arcli config`.';

function withConfigHelp<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof InputIssuesError && !error.suggestion) {
      throw new InputIssuesError(error.message, error.issues, CONFIG_SET_HELP_SUGGESTION);
    }

    if (error instanceof InputValidationError && !error.suggestion) {
      throw new InputValidationError(error.message, error.details, CONFIG_SET_HELP_SUGGESTION);
    }

    throw error;
  }
}

/** Valida un valor como lo haria `arcli config establecer`, sin guardarlo. Lanza un Error con el motivo. */
export function validateConfigValue(publicKey: ConfigPublicKey, rawValue: string): void {
  parseConfigValue(CONFIG_KEY_ALIASES[publicKey], rawValue);
}

export interface ConfigServiceOptions {
  readonly configName?: string;
  readonly cwd?: string;
  readonly projectName?: string;
}

/**
 * `ARCLI_CONFIG_DIR` usa otra carpeta de config (con sus tickets, plugins y certificados): para tener una config
 * aparte o para los tests de punta a punta, que no pueden tocar la real.
 */
export function resolveConfigDirectory(): string | undefined {
  const value = process.env.ARCLI_CONFIG_DIR?.trim();

  return value ? resolve(value) : undefined;
}

function storeLocation(options: ConfigServiceOptions) {
  return {
    configName: options.configName ?? 'config',
    cwd: options.cwd ?? resolveConfigDirectory(),
    projectName: options.projectName ?? 'arcli',
    projectSuffix: '',
  };
}

/**
 * Ruta del config.json sin leerlo: `Conf` la calcula al construirse, pero tambien lee el archivo. Sin defaults y
 * con un deserializador que no parsea, no hay nada que escribir y el archivo queda como esta.
 */
function resolveStorePath(options: ConfigServiceOptions): string {
  return new Conf({ ...storeLocation(options), deserialize: () => ({}) }).path;
}

function defaultTicketPathFor(configPath: string): string {
  return join(dirname(configPath), 'tickets');
}

/**
 * Dónde quedarían el config.json y la carpeta de tickets por defecto, sin leer ni escribir el archivo. Lo usa el
 * setup de los tests para frenar la suite si apuntan fuera de la carpeta temporal.
 *
 * @internal Solo para el setup de los tests: guardarraíl de aislamiento de la config.
 */
export function resolveConfigLocation(options: ConfigServiceOptions = {}): {
  readonly configPath: string;
  readonly ticketPath: string;
} {
  const configPath = resolveStorePath(options);

  return { configPath, ticketPath: defaultTicketPathFor(configPath) };
}

function invalidConfigFileError(path: string): ConfigurationError {
  return new ConfigurationError(
    'El archivo de configuración tiene JSON inválido y no se puede leer.',
    { path },
    'Corregilo a mano, o renombralo (por ejemplo, a config.json.bak) y volvé a cargar los datos con `arcli config establecer` o desde "Configuración" en `arcli`. ARCLI no lo borra ni lo pisa.',
  );
}

/**
 * Un CBU guardado que ya no pasa la validación (por ejemplo, desde que se controlan los verificadores): el error
 * dice que viene de la config, el motivo y cómo cambiarlo.
 */
function invalidSavedCbuError(reason: string): InputIssuesError {
  return new InputIssuesError(
    `El CBU guardado en la config no es válido: ${reason}.`,
    [{ label: 'CBU', mensaje: `${reason[0]?.toUpperCase() ?? ''}${reason.slice(1)}.`, ruta: ['cbu'] }],
    'Cambialo por el correcto con `arcli config establecer cbu <CBU>`; copialo desde el home banking o la constancia del banco.',
  );
}

export class ConfigService {
  private readonly store: Conf<ArcliConfig>;

  public constructor(options: ConfigServiceOptions = {}) {
    try {
      this.store = new Conf<ArcliConfig>({
        ...storeLocation(options),
        clearInvalidConfig: false,
        defaults: CONFIG_DEFAULTS,
      });
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw invalidConfigFileError(resolveStorePath(options));
      }

      throw error;
    }
  }

  public close(): void {
    this.store._closeWatcher();
  }

  public getConfig(): ArcliConfig {
    try {
      return parseZodInput(arcliConfigSchema, this.store.store);
    } catch (error) {
      const savedCbu: unknown = (this.store.store as Record<string, unknown>).cbu;
      const cbuResult = typeof savedCbu === 'string' ? parseCbu(savedCbu) : undefined;

      if (cbuResult && !cbuResult.ok) {
        throw invalidSavedCbuError(cbuResult.reason);
      }

      throw error;
    }
  }

  public getPath(): string {
    return this.store.path;
  }

  public getDefaultTicketPath(): string {
    return defaultTicketPathFor(this.store.path);
  }

  /** Carpeta donde se instala el plugin de PDF, junto a config.json. */
  public getPluginsPath(): string {
    return join(dirname(this.store.path), 'plugins');
  }

  public resolveTicketPath(config: ArcliConfig): string {
    return config.ticketPath ?? this.getDefaultTicketPath();
  }

  /** Absoluta por defecto, para que los PDFs no queden repartidos segun desde donde se ejecuta arcli. */
  public resolvePdfFolder(config: ArcliConfig): string {
    return config.pdfCarpeta ?? join(homedir(), 'arcli', 'comprobantes');
  }

  /** Carpeta de `arcli certificado`, junto a config.json: una subcarpeta por CUIT. */
  public getCertificatesPath(): string {
    return join(dirname(this.store.path), 'certificados');
  }

  public resolvePaths(config: ArcliConfig): {
    readonly certificatesFolder: string;
    readonly pdfFolder: string;
    readonly ticketPath: string;
  } {
    return {
      certificatesFolder: this.getCertificatesPath(),
      pdfFolder: this.resolvePdfFolder(config),
      ticketPath: this.resolveTicketPath(config),
    };
  }

  public initialize(): ArcliConfig {
    const config = this.getConfig();
    this.store.store = config;

    return config;
  }

  public ensureInitialized(): ArcliConfig {
    return this.initialize();
  }

  public setValue(rawKey: string, rawValue: string): ArcliConfig {
    const key = this.resolveKey(rawKey);
    const canonicalKey = CONFIG_KEY_ALIASES[key];
    const parsedValue = withConfigHelp(() => parseConfigValue(canonicalKey, rawValue, key));

    return this.saveIfValid((draft) => {
      deleteLegacyKeys(draft, key);
      setAtPath(draft, canonicalKey, parsedValue);
    });
  }

  public unsetValue(rawKey: string): ArcliConfig {
    const key = this.resolveKey(rawKey);
    const canonicalKey = CONFIG_KEY_ALIASES[key];

    return this.saveIfValid((draft) => {
      deleteLegacyKeys(draft, key);
      deleteAtPath(draft, canonicalKey);
    });
  }

  /**
   * Aplica el cambio sobre una copia y la guarda solo si queda valida: un valor invalido no puede dejar el CLI
   * inutilizable. Una config que ya estaba rota se puede arreglar cambiando o borrando la clave que falla.
   */
  private saveIfValid(change: (draft: Record<string, unknown>) => void): ArcliConfig {
    const draft = structuredClone(this.store.store) as Record<string, unknown>;

    change(draft);

    const config = parseZodInput(arcliConfigSchema, draft);
    this.store.store = config;

    return config;
  }

  private resolveKey(rawKey: string): ConfigPublicKey {
    const key = rawKey.trim();

    if (Object.hasOwn(DEPRECATED_CONFIG_KEYS, key)) {
      return DEPRECATED_CONFIG_KEYS[key].replacement;
    }

    const result = configPublicKeySchema.safeParse(key);

    if (!result.success) {
      throw new InputIssuesError(
        `La clave \`${key}\` no existe.`,
        describeZodIssues(result.error),
        CONFIG_SET_HELP_SUGGESTION,
      );
    }

    return result.data;
  }
}

function deleteLegacyKeys(draft: Record<string, unknown>, key: ConfigPublicKey): void {
  for (const legacyKey of LEGACY_STORED_KEYS[key] ?? []) {
    deleteAtPath(draft, legacyKey);
  }
}

function setAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop() as string;
  let node = target;

  for (const key of keys) {
    const next = node[key];
    node = (next && typeof next === 'object' ? next : (node[key] = {})) as Record<string, unknown>;
  }

  node[last] = value;
}

function deleteAtPath(target: Record<string, unknown>, path: string): void {
  const keys = path.split('.');
  const last = keys.pop() as string;
  const parent = keys.reduce<unknown>(
    (node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined),
    target,
  );

  if (parent && typeof parent === 'object') {
    delete (parent as Record<string, unknown>)[last];
  }
}
