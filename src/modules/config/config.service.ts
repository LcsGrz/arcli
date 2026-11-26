import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ZodError } from 'zod';

import { ConfigurationError, InputIssuesError, InputValidationError } from '../../lib/errors/app-error';
import { withFilePath } from '../../lib/files/file-error';
import type { LocalFiles } from '../../lib/files/local-files';
import { parseCbu } from '../../lib/identity/cbu';
import { deleteAtPath, setAtPath } from '../../lib/json/object-path';
import { describeZodIssues, parseZodInput } from '../billing/billing.zod-errors';

import { accountAliasRemovedWarning, cbuAliasChange, cbuRemovalWarning } from './cbu-alias-change';
import { type ArcliConfig, arcliConfigSchema, CONFIG_DEFAULTS } from './config.schemas';
import {
  type AccountStoredKey,
  type CanonicalConfigKey,
  type ConfigPublicKey,
  configPublicKeySchema,
  storedKeyOf,
} from './config-key-table';
import { DEPRECATED_CONFIG_KEYS } from './config-keys';
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
import { configFilePath, type ConfigStore, type StoredConfig } from './config-store';
import { parseConfigValue } from './config-value-parser';

/**
 * Claves guardadas que se borran al cambiar o borrar la clave publica: la deprecada no puede quedar en el archivo
 * con otro valor, porque se seguiria leyendo si se borra la nueva.
 */
const LEGACY_STORED_KEYS: Partial<Record<AccountStoredKey | ConfigPublicKey, readonly string[]>> = {
  filasPorLista: ['comprobantesPorLista'],
};

/** El aviso de una clave deprecada (`comprobantesPorLista`, `cbu`), para mostrarlo al guardarla o borrarla. */
export function deprecatedConfigKeyWarning(
  rawKey: string,
  action: 'eliminar' | 'establecer' = 'establecer',
): string | undefined {
  const key = rawKey.trim();

  if (!Object.hasOwn(DEPRECATED_CONFIG_KEYS, key)) {
    return undefined;
  }

  const { removeWarning, warning } = DEPRECATED_CONFIG_KEYS[key];

  return action === 'eliminar' ? (removeWarning ?? warning) : warning;
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
export function validateConfigValue(publicKey: ConfigPublicKey, rawValue: string, files: LocalFiles): void {
  parseConfigValue(storedKeyOf(publicKey), rawValue, files);
}

export interface ConfigServiceOptions {
  /** Para validar las rutas que se guardan (certificado, clave, logo, navegador). */
  readonly files: LocalFiles;
  /** El config.json: la app pasa el adaptador sobre la carpeta de datos (src/services/files). */
  readonly store: ConfigStore;
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
export function resolveConfigLocation({ cwd }: { readonly cwd: string }): {
  readonly configPath: string;
  readonly ticketPath: string;
} {
  const configPath = configFilePath(cwd);

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

/**
 * Un cambio ya validado, para aplicarlo sobre lo que se relee al escribir. `saved` es lo releído con los defaults: lo
 * que depende de lo guardado (el alias del CBU) se decide ahí y no al planear, por si otro proceso escribió en el medio.
 */
interface PlannedChange {
  readonly apply: (draft: StoredConfig, saved: StoredConfig) => void;
  readonly keys: readonly CanonicalConfigKey[];
  readonly warning?: (saved: StoredConfig) => string | undefined;
}

/**
 * Lo guardado (o la config recien validada, que es lo que se escribe), completo con los defaults. El archivo se
 * completa solo si esta sano (`completeDefaults`): con una clave rota no se toca nada que la persona no haya pedido.
 */
function withDefaults(stored: ArcliConfig | StoredConfig): StoredConfig {
  return { ...CONFIG_DEFAULTS, ...stored };
}

/** Si a lo guardado le faltan defaults y, completo, queda sano. */
function lacksDefaults(stored: StoredConfig): boolean {
  return (
    Object.keys(CONFIG_DEFAULTS).some((key) => stored[key] === undefined) &&
    arcliConfigSchema.safeParse(withDefaults(stored)).success
  );
}

/**
 * La config de arcli sobre el puerto `ConfigStore`. Cada operacion publica que escribe es un solo `update` y decide
 * sobre lo que relee ahi: lo que otro proceso guardo en el medio se conserva. Sin bloqueo entre procesos (ARQ-26).
 */
export class ConfigService {
  private readonly files: LocalFiles;
  private readonly store: ConfigStore;

  public constructor(options: ConfigServiceOptions) {
    this.files = options.files;
    this.store = options.store;

    try {
      withFilePath(this.store.path, () => this.completeDefaults());
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw invalidConfigFileError(this.store.path);
      }

      throw error;
    }
  }

  /** No queda nada abierto entre operaciones: se mantiene para quien abre y cierra la config. */
  public close(): void {}

  public getConfig(): ArcliConfig {
    return this.parseSaved(this.store.read());
  }

  /** La config guardada, validada; con una clave rota, el error dice cual y como arreglarla. */
  private parseSaved(stored: StoredConfig): ArcliConfig {
    try {
      return parseZodInput(arcliConfigSchema, withDefaults(stored));
    } catch (error) {
      const savedCbu = stored.cbu;
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
    let config: ArcliConfig | undefined;

    this.store.update((stored) => {
      config = this.parseSaved(stored);

      return withDefaults(config);
    });

    return definedAfterUpdate(config);
  }

  public ensureInitialized(): ArcliConfig {
    return this.initialize();
  }

  /** `alias` es solo de `cuenta`: sin el, borra el guardado. */
  public setValue(rawKey: string, rawValue: string, alias?: string): ArcliConfig {
    return this.saveIfValid(this.planSet(rawKey, rawValue, alias));
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
      apply: (draft, saved) => plans.forEach((plan) => plan.apply(draft, saved)),
      // Los valores ya se validaron al planearlos: lo que falle al guardar es de otra clave.
      keys: plans[plans.length - 1].keys,
    });
  }

  /** `config establecer`: como `setValue`, pero guarda aunque queden otras claves que ya estaban rotas. */
  public repairValue(rawKey: string, rawValue: string, alias?: string): ConfigChange {
    return this.saveIfNotWorse(this.planSet(rawKey, rawValue, alias));
  }

  /** `config eliminar`: como `unsetValue`, pero guarda aunque queden otras claves que ya estaban rotas. */
  public repairUnset(rawKey: string): ConfigChange {
    return this.saveIfNotWorse(this.planUnset(rawKey));
  }

  private planSet(rawKey: string, rawValue: string, alias?: string): PlannedChange {
    const key = this.resolveKey(rawKey);

    if (key === 'cuenta') {
      return this.planAccount(rawValue, alias);
    }

    if (alias !== undefined) {
      throw new InputValidationError(`El alias solo se guarda con \`cuenta\`, no con \`${rawKey.trim()}\`.`);
    }

    const canonicalKey = storedKeyOf(key);
    const parsedValue = withConfigHelp(() => parseConfigValue(canonicalKey, rawValue, this.files, key));
    const aliasChange = (saved: StoredConfig) => (key === 'cbu' ? cbuAliasChange(saved, rawValue) : undefined);

    return {
      apply: (draft, saved) => {
        deleteLegacyKeys(draft, key);
        setAtPath(draft, canonicalKey, parsedValue);

        if (aliasChange(saved)?.removesAlias) {
          deleteAtPath(draft, 'aliasCbu');
        }
      },
      keys: [canonicalKey],
      warning: (saved) => aliasChange(saved)?.warning,
    };
  }

  /** El CBU y su alias en un solo cambio. Sin alias, el guardado se borra: podria ser de otra cuenta. */
  private planAccount(rawCbu: string, rawAlias: string | undefined): PlannedChange {
    const cbu = withConfigHelp(() => parseConfigValue('cbu', rawCbu, this.files, 'cuenta'));
    const alias =
      rawAlias === undefined
        ? undefined
        : withConfigHelp(() => parseConfigValue('aliasCbu', rawAlias, this.files, 'cuenta'));

    return {
      apply: (draft) => {
        setAtPath(draft, 'cbu', cbu);

        if (alias === undefined) {
          deleteAtPath(draft, 'aliasCbu');
        } else {
          setAtPath(draft, 'aliasCbu', alias);
        }
      },
      keys: ['cbu', 'aliasCbu'],
      warning: (saved) => (alias === undefined ? accountAliasRemovedWarning(saved) : undefined),
    };
  }

  private planUnset(rawKey: string): PlannedChange {
    const key = this.resolveKey(rawKey);
    // Sin el CBU, su alias no se usa: se borran juntos.
    const keys: readonly CanonicalConfigKey[] =
      key === 'cuenta' || key === 'cbu' ? ['cbu', 'aliasCbu'] : [storedKeyOf(key)];

    return {
      apply: (draft) => {
        deleteLegacyKeys(draft, key);
        keys.forEach((canonicalKey) => deleteAtPath(draft, canonicalKey));
      },
      keys,
      warning: (saved) => (keys.length > 1 ? cbuRemovalWarning(saved) : undefined),
    };
  }

  /** Completa los defaults que falten, solo si lo guardado esta sano. Si no falta nada, no escribe. */
  private completeDefaults(): void {
    if (lacksDefaults(this.store.read())) {
      this.store.update((stored) => (lacksDefaults(stored) ? withDefaults(stored) : undefined));
    }
  }

  /**
   * Aplica el cambio sobre una copia y la guarda solo si queda valida: un valor invalido no puede dejar el CLI
   * inutilizable. Una config que ya estaba rota se puede arreglar cambiando o borrando la clave que falla.
   */
  private saveIfValid(change: PlannedChange): ArcliConfig {
    let config: ArcliConfig | undefined;

    this.store.update((stored) => {
      const saved = withDefaults(stored);
      const draft = structuredClone(saved);

      change.apply(draft, saved);
      config = this.parseDraft(change.keys, draft, saved);

      return withDefaults(config);
    });

    return definedAfterUpdate(config);
  }

  /**
   * Si el cambio deja la config sana, guarda como `saveIfValid`. Si no, guarda solo esa clave sobre lo que hay en el
   * archivo, sin normalizar ni completar el resto, y nada mas que si no hay problemas nuevos. Los avisos salen de lo
   * releido, en el mismo `update`.
   */
  private saveIfNotWorse(change: PlannedChange): ConfigChange {
    let result: ConfigChange | undefined;

    this.store.update((stored) => {
      const saved = withDefaults(stored);
      const draft = structuredClone(saved);
      const warning = change.warning?.(saved);
      const warnings = warning === undefined ? {} : { warnings: [warning] };

      change.apply(draft, saved);

      const error = parseConfigProblems(draft);
      const old = parseConfigProblems(saved);

      if (!error || !change.keys.every((key) => onlyOldProblems(error, old, key))) {
        const config = this.parseDraft(change.keys, draft, saved);

        result = { config, ...warnings };

        return withDefaults(config);
      }

      for (const issue of error.issues) {
        deleteAtPath(draft, issuePath(issue));
      }

      result = {
        config: parseZodInput(arcliConfigSchema, draft),
        pending: describePending(error, this.store.path),
        ...warnings,
      };

      const next = structuredClone(stored);

      change.apply(next, saved);

      return next;
    });

    return definedAfterUpdate(result);
  }

  private parseDraft(
    changedKeys: readonly CanonicalConfigKey[],
    draft: StoredConfig,
    saved: StoredConfig,
  ): ArcliConfig {
    try {
      return parseZodInput(arcliConfigSchema, draft);
    } catch (error) {
      // El valor recien pasado no es un dato guardado: ese error sale como siempre.
      if (
        !(error instanceof ZodError) ||
        error.issues.some((issue) => changedKeys.some((key) => isSameOrInside(issuePath(issue), key)))
      ) {
        throw error;
      }

      throw invalidSavedConfigError(error, parseConfigProblems(saved) ?? error, this.store.path);
    }
  }

  private resolveKey(rawKey: string): AccountStoredKey | ConfigPublicKey {
    const key = rawKey.trim();

    if (Object.hasOwn(DEPRECATED_CONFIG_KEYS, key)) {
      const { replacement, storedAs } = DEPRECATED_CONFIG_KEYS[key];

      return storedAs ?? replacement;
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

/** Lo que la funcion de `update` dejo listo: si `update` volvio sin correrla, el adaptador no cumple el puerto. */
function definedAfterUpdate<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('El almacenamiento de la config no aplicó el cambio.');
  }

  return value;
}

function deleteLegacyKeys(draft: Record<string, unknown>, key: AccountStoredKey | ConfigPublicKey): void {
  for (const legacyKey of LEGACY_STORED_KEYS[key] ?? []) {
    deleteAtPath(draft, legacyKey);
  }
}
