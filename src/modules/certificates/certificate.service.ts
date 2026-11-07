import { readFileSync, writeFileSync } from 'node:fs';

import { AppError, ConfigurationError, InputValidationError } from '../../lib/errors/app-error';
import { maskPath } from '../../lib/paths/mask-path';
import {
  type ArcaCertificateInfo,
  certificateMatchesKey,
  normalizeCertificatePem,
  readArcaCertificate,
} from '../../lib/security/arca-certificate';
import { createCertificateRequest } from '../../lib/security/certificate-request';
import { formatCertificateExpiryDate } from '../config/certificate-expiry';
import { type ArcliConfig, type ArcliEnvironment, formatEnvironmentLabel } from '../config/config.schemas';

import {
  type CertificateFiles,
  ensureCertificateFolder,
  moveIfExists,
  readIfExists,
  resolveCertificateFiles,
  writePrivateFile,
} from './certificate-store';

/** Lo que el servicio necesita de la config: leerla y guardar las rutas como `arcli config establecer`. */
export interface CertificateConfigPort {
  getConfig(): ArcliConfig;
  setValue(key: string, value: string): void;
}

export interface CertificateServiceOptions {
  readonly certificatesRoot: string;
  readonly config: CertificateConfigPort;
  /** Reloj para el vencimiento; solo lo cambian los tests. */
  readonly now?: () => Date;
}

export interface GenerateCertificateOptions {
  readonly alias?: string;
  readonly environment: ArcliEnvironment;
  /** Descartar un pedido pendiente y armar otro. */
  readonly replace?: boolean;
}

export interface GeneratedCertificateRequest {
  readonly alias: string;
  readonly csrPem: string;
  readonly cuit: string;
  readonly environment: ArcliEnvironment;
  readonly keyPath: string;
  readonly requestPath: string;
}

export interface ImportCertificateOptions {
  /** Contenido del `.crt`, del archivo o pegado. */
  readonly content: string;
  /** Si el emisor no es una autoridad de ARCA conocida; si lo es, tiene que coincidir. */
  readonly environment?: ArcliEnvironment;
  /** Pisar el certificado que ya estaba configurado para ese entorno. */
  readonly replace?: boolean;
}

export interface ImportedCertificate {
  readonly alias?: string;
  readonly certificatePath: string;
  readonly cuit: string;
  readonly environment: ArcliEnvironment;
  readonly expiresAt: Date;
  readonly keyPath: string;
  /** Habia otro certificado configurado para el entorno y se reemplazo. */
  readonly replaced: boolean;
}

export interface CertificateStatus {
  readonly alias?: string;
  readonly certificatePath?: string;
  readonly environment: ArcliEnvironment;
  readonly expiresAt?: Date;
  readonly keyPath?: string;
  /** El CSR de un pedido de `generar` sin importar. */
  readonly pendingRequestPath?: string;
  /** El certificado configurado no se pudo leer (no existe o no es X.509). */
  readonly unreadable: boolean;
}

export const DEFAULT_CERTIFICATE_ALIAS = 'arcli';

function certificateError(code: string, message: string, suggestion?: string): AppError {
  return new AppError(message, { code, suggestion });
}

export class CertificateService {
  private readonly certificatesRoot: string;
  private readonly config: CertificateConfigPort;
  private readonly now: () => Date;

  public constructor(options: CertificateServiceOptions) {
    this.certificatesRoot = options.certificatesRoot;
    this.config = options.config;
    this.now = options.now ?? (() => new Date());
  }

  /** Arma la clave y el CSR del entorno. Quedan pendientes: la clave activa sigue andando hasta importar. */
  public generate(options: GenerateCertificateOptions): GeneratedCertificateRequest {
    const config = this.config.getConfig();
    const cuit = this.requireCuit(config);
    const files = this.files(cuit, options.environment);

    if (readIfExists(files.pendingKey) && !options.replace) {
      throw certificateError(
        'CERTIFICATE_REQUEST_PENDING',
        `Ya hay un pedido de certificado de ${formatEnvironmentLabel(options.environment)} sin importar.`,
        `Si ya subiste el CSR a ARCA, importá el certificado con \`arcli certificado importar <archivo>\`. Para descartarlo y armar otro, sumá \`--reemplazar\`.`,
      );
    }

    const alias = options.alias?.trim() || DEFAULT_CERTIFICATE_ALIAS;
    const request = createCertificateRequest({ alias, cuit, organization: config.emisor.razonSocial });

    ensureCertificateFolder(files);
    writePrivateFile(files.pendingKey, request.privateKeyPem);
    writeFileSync(files.pendingRequest, request.csrPem, 'utf8');

    return {
      alias,
      csrPem: request.csrPem,
      cuit,
      environment: options.environment,
      keyPath: files.pendingKey,
      requestPath: files.pendingRequest,
    };
  }

  /** Que hay configurado en el entorno y si quedo un pedido sin importar. Solo lee archivos locales. */
  public status(environment: ArcliEnvironment): CertificateStatus {
    const config = this.config.getConfig();
    const certificatePath = config.cert[environment];
    const files = config.cuit ? this.files(config.cuit, environment) : undefined;
    const pending = files && readIfExists(files.pendingKey) !== undefined ? files.pendingRequest : undefined;
    let info: ArcaCertificateInfo | undefined;

    try {
      info = certificatePath ? readArcaCertificate(readFileSync(certificatePath, 'utf8')) : undefined;
    } catch {
      info = undefined;
    }

    return {
      alias: info?.alias,
      certificatePath,
      environment,
      expiresAt: info?.expiresAt,
      keyPath: config.key[environment],
      pendingRequestPath: pending,
      unreadable: Boolean(certificatePath) && !info,
    };
  }

  /** El CSR pendiente del entorno, para volver a mostrarlo. */
  public readPendingRequest(environment: ArcliEnvironment): string | undefined {
    const cuit = this.config.getConfig().cuit;

    return cuit ? readIfExists(this.files(cuit, environment).pendingRequest) : undefined;
  }

  /**
   * Valida el certificado (X.509, emisor de ARCA, CUIT, vencimiento y clave), lo guarda en la carpeta del CUIT y
   * configura `cert.<entorno>` y `key.<entorno>`. Nada se toca hasta que todo valida.
   */
  public import(options: ImportCertificateOptions): ImportedCertificate {
    const config = this.config.getConfig();
    const cuit = this.requireCuit(config);
    const pem = normalizeCertificatePem(options.content);

    if (!pem) {
      throw certificateError(
        'CERTIFICATE_INVALID',
        'El archivo no tiene un certificado: falta el bloque "-----BEGIN CERTIFICATE-----".',
        'Usá el .crt que bajaste de ARCA, sin abrirlo ni guardarlo con otro programa.',
      );
    }

    const info = this.readCertificate(pem);
    const environment = this.resolveEnvironment(info, options.environment);

    if (info.cuit !== cuit) {
      throw certificateError(
        'CERTIFICATE_CUIT_MISMATCH',
        `El certificado es del CUIT ${info.cuit ?? 'desconocido'} y la config usa el ${cuit}.`,
        'Revisá que lo hayas bajado con la clave fiscal del CUIT configurado, o cambiá el CUIT con `arcli config establecer cuit`.',
      );
    }

    if (info.expiresAt.getTime() <= this.now().getTime()) {
      throw certificateError(
        'CERTIFICATE_EXPIRED',
        `El certificado venció el ${formatCertificateExpiryDate(info.expiresAt)}.`,
        `Generá uno nuevo con \`arcli certificado generar --${environment}\`.`,
      );
    }

    const files = this.files(cuit, environment);
    const key = this.findMatchingKey(pem, files, config, environment);
    const configuredCertificate = config.cert[environment];
    const replaced = Boolean(configuredCertificate) && configuredCertificate !== files.certificate;

    if (replaced && !options.replace) {
      throw certificateError(
        'CERTIFICATE_REPLACE_CONFIRMATION',
        `Ya hay un certificado de ${formatEnvironmentLabel(environment)} configurado: ${maskPath(configuredCertificate ?? '')}.`,
        'Para reemplazarlo, sumá `--reemplazar`.',
      );
    }

    ensureCertificateFolder(files);

    let keyPath = key.path;

    if (key.pending) {
      moveIfExists(files.key, files.previousKey);
      moveIfExists(files.pendingKey, files.key);
      moveIfExists(files.pendingRequest, files.request);
      keyPath = files.key;
    }

    moveIfExists(files.certificate, files.previousCertificate);
    writeFileSync(files.certificate, pem, 'utf8');
    this.config.setValue(`cert.${environment}`, files.certificate);
    this.config.setValue(`key.${environment}`, keyPath);

    return {
      alias: info.alias,
      certificatePath: files.certificate,
      cuit,
      environment,
      expiresAt: info.expiresAt,
      keyPath,
      replaced,
    };
  }

  private files(cuit: string, environment: ArcliEnvironment): CertificateFiles {
    return resolveCertificateFiles(this.certificatesRoot, cuit, environment);
  }

  private requireCuit(config: ArcliConfig): string {
    if (!config.cuit) {
      throw new ConfigurationError(
        'Falta el CUIT del emisor.',
        undefined,
        'Configuralo con `arcli config establecer cuit <CUIT>`: el certificado se pide para ese CUIT.',
      );
    }

    return config.cuit;
  }

  private readCertificate(pem: string): ArcaCertificateInfo {
    try {
      return readArcaCertificate(pem);
    } catch {
      throw certificateError(
        'CERTIFICATE_INVALID',
        'El archivo no es un certificado X.509 válido.',
        'Usá el .crt que bajaste de ARCA, sin abrirlo ni guardarlo con otro programa.',
      );
    }
  }

  private resolveEnvironment(info: ArcaCertificateInfo, requested?: ArcliEnvironment): ArcliEnvironment {
    if (info.environment && requested && info.environment !== requested) {
      throw new InputValidationError(
        `El certificado es de ${formatEnvironmentLabel(info.environment)} (lo firmó "${info.issuer}") y pediste ${formatEnvironmentLabel(requested)}.`,
      );
    }

    const environment = info.environment ?? requested;

    if (!environment) {
      throw certificateError(
        'CERTIFICATE_ENVIRONMENT_UNKNOWN',
        `No se reconoce quién firmó el certificado ("${info.issuer}"): ARCA usa "Computadores Test" en testing y "Computadores" en producción.`,
        'Si estás seguro de que es de ARCA, indicá el entorno con `--testing` o `--produccion`.',
      );
    }

    return environment;
  }

  /** La clave del pedido pendiente, o la ya configurada si se vuelve a importar el mismo certificado. */
  private findMatchingKey(
    pem: string,
    files: CertificateFiles,
    config: ArcliConfig,
    environment: ArcliEnvironment,
  ): { readonly path: string; readonly pending: boolean } {
    const pendingKey = readIfExists(files.pendingKey);

    if (pendingKey && certificateMatchesKey(pem, pendingKey)) {
      return { path: files.pendingKey, pending: true };
    }

    const configuredKeyPath = config.key[environment];
    const configuredKey = configuredKeyPath ? readKey(configuredKeyPath) : undefined;

    if (configuredKeyPath && configuredKey && certificateMatchesKey(pem, configuredKey)) {
      return { path: configuredKeyPath, pending: false };
    }

    throw certificateError(
      'CERTIFICATE_KEY_MISMATCH',
      `El certificado no corresponde a ${pendingKey ? 'la clave del último pedido' : 'ninguna clave de este CUIT'}.`,
      pendingKey
        ? 'Bajá de ARCA el certificado que creaste con el último CSR de `arcli certificado generar`.'
        : `Primero armá el pedido con \`arcli certificado generar --${environment}\` y subí ese CSR a ARCA.`,
    );
  }
}

function readKey(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}
