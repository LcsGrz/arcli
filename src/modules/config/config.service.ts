import Conf from 'conf';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ZodError } from 'zod';

import { ConfigurationError, InputIssuesError, InputValidationError } from '../../lib/errors/app-error';
import { withFilePath } from '../../lib/files/file-error';
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

/** Como se llama en la config publica lo que esta en esa ruta del archivo, y con que clave se cambia. */
interface SavedKey {
  /** Con `config eliminar` tambien se arregla: no alcanza para un grupo entero, como `emisor`. */
  readonly canDelete: boolean;
  readonly key: ConfigPublicKey;
  readonly names: readonly string[];
}

function findSavedKey(path: string): SavedKey | undefined {
  if (Object.hasOwn(DEPRECATED_CONFIG_KEYS, path)) {
    return { canDelete: false, key: DEPRECATED_CONFIG_KEYS[path].replacement, names: [path] };
  }

  const entries = Object.entries(CONFIG_KEY_ALIASES) as Array<[ConfigPublicKey, CanonicalConfigKey]>;
  const exact = entries.find(([, canonical]) => canonical === path);

  if (exact) {
    return { canDelete: true, key: exact[0], names: [exact[0]] };
  }

  const keys = entries.filter(([, canonical]) => canonical.startsWith(`${path}.`)).map(([key]) => key);

  return keys.length === 0
    ? undefined
    : { canDelete: false, key: keys[0], names: keys.every((key) => key.startsWith(`${path}.`)) ? [path] : keys };
}

function issuePath(issue: { readonly path: PropertyKey[] }): string {
  return issue.path.map(String).join('.');
}

/** El motivo, para despues del nombre publico: sin el interno adelante y en minuscula. */
function describeReason(mensaje: string, path: string): string {
  const subject = `\`${path}\` `;
  const reason = mensaje.startsWith(subject) ? mensaje.slice(subject.length) : mensaje;
  const text = reason.replace(/^\p{Lu}(?=\p{Ll})/u, (letter) => letter.toLowerCase());

  return text.endsWith('.') ? text : `${text}.`;
}

/**
 * Datos invalidos que ya estaban en el archivo: el error dice que vienen de la config guardada, con la clave publica y
 * que hacer. `detalles` es el de siempre, con las rutas internas (contrato).
 *
 * @param saved los problemas del archivo tal como esta: con mas de uno, `config establecer` no puede guardar ninguno.
 */
function invalidSavedConfigError(error: ZodError, saved: ZodError, configPath: string): InputIssuesError {
  const issues = describeZodIssues(error);
  const problems = error.issues.map((issue, index) => {
    const path = issuePath(issue);
    const names = findSavedKey(path)?.names ?? [path];

    return `${names.map((name) => `\`${name}\``).join(', ')}: ${describeReason(issues[index].mensaje, path)}`;
  });
  const subject = problems.length === 1 ? 'un dato inválido' : 'datos inválidos';

  return new InputIssuesError(
    `La configuración guardada tiene ${subject}. ${problems.join(' ')}`,
    issues,
    suggestConfigFix(saved, configPath),
  );
}

function suggestConfigFix(saved: ZodError, configPath: string): string {
  const keys = saved.issues.map((issue) => findSavedKey(issuePath(issue)));
  const [first] = keys;

  if (!first || keys.some((key) => key?.key !== first.key)) {
    // La ruta va entera: hay que poder abrir el archivo, y `arcli config ruta` tampoco anda con la config rota.
    return `Con más de un dato mal, \`arcli config establecer\` no puede guardar ninguno: corregilos en ${configPath}, o renombrá ese archivo y volvé a cargar los datos.`;
  }

  const set = `Corregilo con \`arcli config establecer ${first.key} <valor>\``;

  return first.canDelete ? `${set} o borralo con \`arcli config eliminar ${first.key}\`.` : `${set}.`;
}

export class ConfigService {
  private readonly store: Conf<ArcliConfig>;

  public constructor(options: ConfigServiceOptions = {}) {
    try {
      // La carpeta por defecto la sabe `Conf`, que no llego a crearse: ahi alcanza con `arcli`.
      this.store = withFilePath(
        join(options.cwd ?? resolveConfigDirectory() ?? 'arcli', `${options.configName ?? 'config'}.json`),
        () =>
          new Conf<ArcliConfig>({
            ...storeLocation(options),
            clearInvalidConfig: false,
            defaults: CONFIG_DEFAULTS,
          }),
      );
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

      throw error instanceof ZodError ? invalidSavedConfigError(error, error, this.store.path) : error;
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

    return this.saveIfValid(canonicalKey, (draft) => {
      deleteLegacyKeys(draft, key);
      setAtPath(draft, canonicalKey, parsedValue);
    });
  }

  public unsetValue(rawKey: string): ArcliConfig {
    const key = this.resolveKey(rawKey);
    const canonicalKey = CONFIG_KEY_ALIASES[key];

    return this.saveIfValid(canonicalKey, (draft) => {
      deleteLegacyKeys(draft, key);
      deleteAtPath(draft, canonicalKey);
    });
  }

  /**
   * Aplica el cambio sobre una copia y la guarda solo si queda valida: un valor invalido no puede dejar el CLI
   * inutilizable. Una config que ya estaba rota se puede arreglar cambiando o borrando la clave que falla.
   */
  private saveIfValid(changedKey: CanonicalConfigKey, change: (draft: Record<string, unknown>) => void): ArcliConfig {
    const draft = structuredClone(this.store.store) as Record<string, unknown>;

    change(draft);

    const config = this.parseDraft(changedKey, draft);
    this.store.store = config;

    return config;
  }

  private parseDraft(changedKey: CanonicalConfigKey, draft: Record<string, unknown>): ArcliConfig {
    try {
      return parseZodInput(arcliConfigSchema, draft);
    } catch (error) {
      // El valor recien pasado no es un dato guardado: ese error sale como siempre.
      const isNewValue = (path: string) => path === changedKey || path.startsWith(`${changedKey}.`);

      if (!(error instanceof ZodError) || error.issues.some((issue) => isNewValue(issuePath(issue)))) {
        throw error;
      }

      const saved = arcliConfigSchema.safeParse(this.store.store).error;

      throw invalidSavedConfigError(error, saved ?? error, this.store.path);
    }
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
