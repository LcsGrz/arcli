import Conf from 'conf';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ZodError } from 'zod';

import { ConfigurationError, InputIssuesError, InputValidationError } from '../../lib/errors/app-error';
import { withFilePath } from '../../lib/files/file-error';
import { parseCbu } from '../../lib/identity/cbu';
import { deleteAtPath, setAtPath } from '../../lib/json/object-path';
import { describeZodIssues, parseZodInput } from '../billing/billing.zod-errors';

import { cbuAliasChange } from './cbu-alias-change';
import {
  type ArcliConfig,
  arcliConfigSchema,
  CONFIG_DEFAULTS,
  type ConfigPublicKey,
  configPublicKeySchema,
} from './config.schemas';
import { CONFIG_KEY_ALIASES, DEPRECATED_CONFIG_KEYS } from './config-keys';
import {
  describePending,
  invalidSavedCbuError,
  invalidSavedConfigError,
  isSameOrInside,
  issuePath,
  onlyOldProblems,
  parseConfigProblems,
  type PendingConfigProblems,
  suggestConfigFix,
} from './config-problems';
import { type CanonicalConfigKey, parseConfigValue } from './config-value-parser';

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

export interface ConfigChange {
  /** Con `pending`, sin las claves rotas: las que tienen default lo traen y no es lo guardado. */
  readonly config: ArcliConfig;
  readonly pending?: PendingConfigProblems;
  /** Lo que el cambio hizo ademas de lo pedido, ya guardado. */
  readonly warnings?: readonly string[];
}

interface PlannedChange {
  readonly apply: (draft: Record<string, unknown>) => void;
  readonly key: CanonicalConfigKey;
  readonly warning?: string;
}

export class ConfigService {
  private readonly store: Conf<Record<string, unknown>>;

  public constructor(options: ConfigServiceOptions = {}) {
    try {
      // La carpeta por defecto la sabe `Conf`, que no llego a crearse: ahi alcanza con `arcli`.
      const path = join(options.cwd ?? resolveConfigDirectory() ?? 'arcli', `${options.configName ?? 'config'}.json`);

      this.store = withFilePath(
        path,
        () =>
          new Conf<Record<string, unknown>>({
            ...storeLocation(options),
            clearInvalidConfig: false,
          }),
      );
      withFilePath(path, () => this.completeDefaults());
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
      return parseZodInput(arcliConfigSchema, this.readSaved());
    } catch (error) {
      const savedCbu = this.store.store.cbu;
      const cbuResult = typeof savedCbu === 'string' ? parseCbu(savedCbu) : undefined;

      if (cbuResult && !cbuResult.ok) {
        // Con otra clave rota, la sugerencia del CBU sola no alcanza.
        throw invalidSavedCbuError(
          cbuResult.reason,
          error instanceof ZodError && error.issues.length > 1 ? suggestConfigFix(error, this.store.path) : undefined,
        );
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
    this.writeComplete(config);

    return config;
  }

  public ensureInitialized(): ArcliConfig {
    return this.initialize();
  }

  public setValue(rawKey: string, rawValue: string): ArcliConfig {
    return this.saveIfValid(this.planSet(rawKey, rawValue));
  }

  public unsetValue(rawKey: string): ArcliConfig {
    return this.saveIfValid(this.planUnset(rawKey));
  }

  /** Varios cambios juntos: se guardan todos o ninguno. */
  public changeValues(changes: {
    readonly remove: readonly string[];
    readonly set: ReadonlyArray<readonly [key: string, value: string]>;
  }): ArcliConfig {
    const plans = [
      ...changes.remove.map((key) => this.planUnset(key)),
      ...changes.set.map(([key, value]) => this.planSet(key, value)),
    ];

    return this.saveIfValid({
      apply: (draft) => plans.forEach((plan) => plan.apply(draft)),
      // Los valores ya se validaron al planearlos: lo que falle al guardar es de otra clave.
      key: plans[plans.length - 1].key,
    });
  }

  /** `config establecer`: como `setValue`, pero guarda aunque queden otras claves que ya estaban rotas. */
  public repairValue(rawKey: string, rawValue: string): ConfigChange {
    const change = this.planSet(rawKey, rawValue);
    const result = this.saveIfNotWorse(change);

    return change.warning === undefined ? result : { ...result, warnings: [change.warning] };
  }

  /** `config eliminar`: como `unsetValue`, pero guarda aunque queden otras claves que ya estaban rotas. */
  public repairUnset(rawKey: string): ConfigChange {
    return this.saveIfNotWorse(this.planUnset(rawKey));
  }

  private planSet(rawKey: string, rawValue: string): PlannedChange {
    const key = this.resolveKey(rawKey);
    const canonicalKey = CONFIG_KEY_ALIASES[key];
    const parsedValue = withConfigHelp(() => parseConfigValue(canonicalKey, rawValue, key));
    const aliasChange = key === 'cbu' ? cbuAliasChange(this.readSaved(), rawValue) : undefined;

    return {
      apply: (draft) => {
        deleteLegacyKeys(draft, key);
        setAtPath(draft, canonicalKey, parsedValue);

        if (aliasChange?.removesAlias) {
          deleteAtPath(draft, CONFIG_KEY_ALIASES.aliasCbu);
        }
      },
      key: canonicalKey,
      warning: aliasChange?.warning,
    };
  }

  private planUnset(rawKey: string): PlannedChange {
    const key = this.resolveKey(rawKey);
    const canonicalKey = CONFIG_KEY_ALIASES[key];

    return {
      apply: (draft) => {
        deleteLegacyKeys(draft, key);
        deleteAtPath(draft, canonicalKey);
      },
      key: canonicalKey,
    };
  }

  /**
   * Lo guardado, completo con los defaults. El archivo se completa solo si esta sano (`completeDefaults`): con una
   * clave rota no se toca nada que la persona no haya pedido.
   */
  private readSaved(): Record<string, unknown> {
    return { ...CONFIG_DEFAULTS, ...this.store.store };
  }

  private writeComplete(config: ArcliConfig): void {
    this.store.store = { ...CONFIG_DEFAULTS, ...config };
  }

  private completeDefaults(): void {
    const stored = this.store.store;

    if (
      Object.keys(CONFIG_DEFAULTS).some((key) => stored[key] === undefined) &&
      arcliConfigSchema.safeParse(this.readSaved()).success
    ) {
      this.store.store = this.readSaved();
    }
  }

  /**
   * Aplica el cambio sobre una copia y la guarda solo si queda valida: un valor invalido no puede dejar el CLI
   * inutilizable. Una config que ya estaba rota se puede arreglar cambiando o borrando la clave que falla.
   */
  private saveIfValid(change: PlannedChange): ArcliConfig {
    const draft = structuredClone(this.readSaved());

    change.apply(draft);

    const config = this.parseDraft(change.key, draft);
    this.writeComplete(config);

    return config;
  }

  /**
   * Si el cambio deja la config sana, guarda como `saveIfValid`. Si no, guarda solo esa clave sobre lo que hay en el
   * archivo, sin normalizar ni completar el resto, y nada mas que si no hay problemas nuevos.
   */
  private saveIfNotWorse(change: PlannedChange): ConfigChange {
    const saved = this.readSaved();
    const draft = structuredClone(saved);

    change.apply(draft);

    const error = parseConfigProblems(draft);

    if (!error || !onlyOldProblems(error, parseConfigProblems(saved), change.key)) {
      return { config: this.saveIfValid(change) };
    }

    for (const issue of error.issues) {
      deleteAtPath(draft, issuePath(issue));
    }

    const result: ConfigChange = {
      config: parseZodInput(arcliConfigSchema, draft),
      pending: describePending(error, this.store.path),
    };
    const stored = structuredClone({ ...this.store.store });

    change.apply(stored);
    this.store.store = stored;

    return result;
  }

  private parseDraft(changedKey: CanonicalConfigKey, draft: Record<string, unknown>): ArcliConfig {
    try {
      return parseZodInput(arcliConfigSchema, draft);
    } catch (error) {
      // El valor recien pasado no es un dato guardado: ese error sale como siempre.
      if (!(error instanceof ZodError) || error.issues.some((issue) => isSameOrInside(issuePath(issue), changedKey))) {
        throw error;
      }

      throw invalidSavedConfigError(error, parseConfigProblems(this.readSaved()) ?? error, this.store.path);
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
