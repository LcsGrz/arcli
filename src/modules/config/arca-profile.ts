import { ConfigurationError } from '../../lib/errors/app-error';

import type { CertificateExpiryNotice } from './certificate-expiry';
import { type ArcliConfig, type ArcliEnvironment, MISSING_CUIT_MESSAGE } from './config.schemas';

/**
 * Con que se habla con ARCA: el CUIT, el entorno, los PEM ya leidos y donde van los tickets de WSAA. Es lo que el
 * cliente del SDK recibe como contexto; se define aca para que el nucleo no conozca los tipos del SDK.
 */
interface ArcaContext {
  readonly cert: string;
  readonly cuit: number;
  readonly key: string;
  readonly production?: boolean;
  readonly ticketPath?: string;
}

/**
 * El perfil de ARCA ya resuelto: la config, el entorno elegido y el contexto con los certificados. No sabe de flags
 * ni de salida: eso lo suma quien lo llama (en la app CLI, `CliArcaRuntime`).
 */
export interface ArcaProfile {
  /**
   * El del entorno activo, solo si vence en menos de 30 dias o ya vencio: vencido, corta antes de ir a ARCA. Se
   * calcula con el PEM ya leido para el contexto, sin red.
   */
  readonly certificateExpiry?: CertificateExpiryNotice;
  /** Los avisos de todos los certificados configurados, el del entorno activo primero: los que se muestran. */
  readonly certificateNotices: readonly CertificateExpiryNotice[];
  readonly config: ArcliConfig;
  readonly context: ArcaContext;
  /** El CUIT emisor, el mismo de `context.cuit`. */
  readonly cuit: number;
  readonly environment: ArcliEnvironment;
  readonly pointOfSale?: number;
}

/** `--testing` y `--produccion` como datos: el nucleo no conoce los flags de la app. */
export interface EnvironmentFlags {
  readonly produccion?: boolean;
  readonly testing?: boolean;
}

const BOTH_ENVIRONMENT_FLAGS_MESSAGE = 'Usá `--testing` o `--produccion`, pero no ambos a la vez.';

/** El entorno pedido con un flag, o `undefined` sin ninguno. Los dos juntos son un error de configuracion. */
export function explicitEnvironment(flags: EnvironmentFlags): ArcliEnvironment | undefined {
  if (flags.testing && flags.produccion) {
    throw new ConfigurationError(BOTH_ENVIRONMENT_FLAGS_MESSAGE);
  }

  return flags.testing ? 'testing' : flags.produccion ? 'produccion' : undefined;
}

/** El entorno de trabajo: el del flag, o el de la config. */
export function resolveEnvironment(
  flags: EnvironmentFlags,
  config: Pick<ArcliConfig, 'entornoPorDefecto'>,
): ArcliEnvironment {
  return explicitEnvironment(flags) ?? config.entornoPorDefecto;
}

/** El CUIT emisor como numero, para el contexto de ARCA. */
export function resolveCuit(config: Pick<ArcliConfig, 'cuit'>): number {
  const rawValue = config.cuit;

  if (!rawValue) {
    throw new ConfigurationError(MISSING_CUIT_MESSAGE);
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  // Defensa: hoy el esquema de la config ya rechaza un CUIT que no tenga 11 digitos.
  if (!Number.isInteger(parsedValue) || rawValue.length !== 11) {
    throw new ConfigurationError(`El CUIT "${rawValue}" no es válido. Debe tener 11 dígitos.`);
  }

  return parsedValue;
}

/** Las rutas del certificado y la clave del entorno; si falta una, el error dice que clave de la config cargar. */
export function credentialPaths(
  config: Pick<ArcliConfig, 'cert' | 'key'>,
  environment: ArcliEnvironment,
): { readonly certPath: string; readonly keyPath: string } {
  const certPath = config.cert[environment];

  if (!certPath) {
    throw new ConfigurationError(`Falta la ruta del certificado para ${environment}. Configurá "cert.${environment}".`);
  }

  const keyPath = config.key[environment];

  if (!keyPath) {
    throw new ConfigurationError(
      `Falta la ruta de la clave privada para ${environment}. Configurá "key.${environment}".`,
    );
  }

  return { certPath, keyPath };
}
