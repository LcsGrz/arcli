import Conf from 'conf';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  ArcliConfig,
  arcliConfigSchema,
  CONFIG_DEFAULTS,
  ConfigPublicKey,
  configPublicKeySchema,
} from './config.schemas';
import { type CanonicalConfigKey, parseConfigValue } from './config-value-parser';

const CONFIG_KEY_ALIASES: Record<ConfigPublicKey, CanonicalConfigKey> = {
  alicuota: 'alicuotaPorDefecto',
  aliasCbu: 'aliasCbu',
  cbu: 'cbu',
  'cert.produccion': 'cert.produccion',
  'cert.testing': 'cert.testing',
  concepto: 'conceptoPorDefecto',
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
  ivaReceptor: 'ivaReceptorPorDefecto',
  json: 'output.jsonPorDefecto',
  'key.produccion': 'key.produccion',
  'key.testing': 'key.testing',
  moneda: 'monedaPorDefecto',
  bruto: 'output.brutoPorDefecto',
  pdf: 'pdf',
  pdfCarpeta: 'pdfCarpeta',
  pdfNavegador: 'pdfNavegador',
  puntoVenta: 'puntoVentaPorDefecto',
  ticketPath: 'ticketPath',
  verificarFce: 'verificarFce',
};

export interface ConfigServiceOptions {
  readonly configName?: string;
  readonly cwd?: string;
  readonly projectName?: string;
}

export class ConfigService {
  private readonly store: Conf<ArcliConfig>;

  public constructor(options: ConfigServiceOptions = {}) {
    this.store = new Conf<ArcliConfig>({
      clearInvalidConfig: false,
      configName: options.configName ?? 'config',
      cwd: options.cwd,
      defaults: CONFIG_DEFAULTS,
      projectName: options.projectName ?? 'arcli',
      projectSuffix: '',
    });
  }

  public close(): void {
    this.store._closeWatcher();
  }

  public getConfig(): ArcliConfig {
    return arcliConfigSchema.parse(this.store.store);
  }

  public getPath(): string {
    return this.store.path;
  }

  public getDefaultTicketPath(): string {
    return join(dirname(this.store.path), 'tickets');
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

  public resolvePaths(config: ArcliConfig): { readonly pdfFolder: string; readonly ticketPath: string } {
    return { pdfFolder: this.resolvePdfFolder(config), ticketPath: this.resolveTicketPath(config) };
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
    const parsedValue = parseConfigValue(canonicalKey, rawValue);

    this.store.set(canonicalKey, parsedValue);

    const config = this.getConfig();
    this.store.store = config;

    return config;
  }

  public unsetValue(rawKey: string): ArcliConfig {
    const key = this.resolveKey(rawKey);
    const canonicalKey = CONFIG_KEY_ALIASES[key];

    this.store.delete(canonicalKey);

    const config = this.getConfig();
    this.store.store = config;

    return config;
  }

  private resolveKey(rawKey: string): ConfigPublicKey {
    return configPublicKeySchema.parse(rawKey.trim());
  }
}
