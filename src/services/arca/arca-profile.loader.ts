import { ensurePathExists, readPemFile } from '../../lib/security/pem';
import { type ArcaProfile, credentialPaths, resolveCuit } from '../../modules/config/arca-profile';
import { inspectConfiguredCertificates } from '../../modules/config/certificate-expiry';
import type { ArcliConfig, ArcliEnvironment } from '../../modules/config/config.schemas';

export interface CheckArcaProfileOptions {
  readonly environment: ArcliEnvironment;
}

export interface ArcaProfileCheck {
  readonly certPath: string;
  readonly cuit: number;
  readonly keyPath: string;
}

export interface LoadArcaProfileOptions extends CheckArcaProfileOptions {
  /** Reloj para el vencimiento del certificado; solo lo cambian los tests. */
  readonly now?: Date;
  /** Carpeta de los tickets de WSAA (la de la config, o `ticketPath`). */
  readonly ticketPath: string;
}

/**
 * Que el entorno se pueda usar: CUIT y las rutas del certificado y la clave, y que los archivos existan. No los lee
 * ni mira el vencimiento: es lo que valida `config revisar`.
 */
export function checkArcaProfile(config: ArcliConfig, options: CheckArcaProfileOptions): ArcaProfileCheck {
  const cuit = resolveCuit(config);
  const { certPath, keyPath } = credentialPaths(config, options.environment);

  ensurePathExists(certPath, 'certificado');
  ensurePathExists(keyPath, 'clave privada');

  return { certPath, cuit, keyPath };
}

/**
 * El perfil completo: valida como `checkArcaProfile`, lee los PEM y calcula los avisos de vencimiento de todos los
 * certificados configurados (el del entorno activo con el PEM ya leido). No escribe nada ni toca permisos.
 */
export function loadArcaProfile(config: ArcliConfig, options: LoadArcaProfileOptions): ArcaProfile {
  const { environment } = options;
  const { certPath, cuit, keyPath } = checkArcaProfile(config, { environment });
  const cert = readPemFile(certPath, 'certificado');
  const certificateNotices = inspectConfiguredCertificates(config.cert, {
    activeEnvironment: environment,
    activePem: cert,
    now: options.now,
  });

  return {
    certificateExpiry: certificateNotices.find((notice) => notice.environment === environment),
    certificateNotices,
    config,
    context: {
      cert,
      cuit,
      key: readPemFile(keyPath, 'clave privada'),
      production: environment === 'produccion',
      ticketPath: options.ticketPath,
    },
    cuit,
    environment,
    pointOfSale: config.puntoVentaPorDefecto,
  };
}
