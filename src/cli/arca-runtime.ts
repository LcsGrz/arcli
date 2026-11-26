import { dirname } from 'node:path';

import { CERTIFICATE_GUIDE_URL, EXPORT_CERTIFICATE_GUIDE_URL } from '../lib/links';
import { type ArcaProfile, credentialPaths, resolveCuit, resolveEnvironment } from '../modules/config/arca-profile';
import {
  type CertificateExpiryNotice,
  exportCertificateView,
  renewalGuideUrl,
} from '../modules/config/certificate-expiry';
import type { ArcliConfig, ArcliEnvironment } from '../modules/config/config.schemas';
import type { ConfigService } from '../modules/config/config.service';
import { checkArcaProfile, loadArcaProfile } from '../services/arca/arca-profile.loader';
import { restrictFolderToOwner } from '../services/files/restrict-to-owner';
import { certificateBanner, writeTerminalNotice } from '../ui';

import { withConfigService } from './config-service';
import type { GlobalCliOptions } from './types';

/** El perfil de ARCA mas como responde el comando: lo que reciben los comandos y el modo interactivo. */
export interface CliArcaRuntime extends ArcaProfile {
  readonly outputJson: boolean;
  readonly outputRaw: boolean;
}

type CertificateRuntime = Pick<CliArcaRuntime, 'certificateExpiry' | 'certificateNotices' | 'outputJson'>;

/**
 * Un solo recuadro con todos los certificados por vencer o vencidos, una linea por entorno y el link una vez. En
 * rojo si alguno vencio. Lo usan los comandos y el modo interactivo.
 */
export function renderCertificateNotices(notices: readonly CertificateExpiryNotice[]): string | undefined {
  if (notices.length === 0) {
    return undefined;
  }

  const general = notices.filter((notice) => notice.use !== 'exportacion');
  const guideUrls = [...new Set(general.map(renewalGuideUrl))];
  // Uno de exportacion no se renueva como los generales: con los dos, van los dos links.
  const generalUrl = guideUrls.length > 1 ? CERTIFICATE_GUIDE_URL : guideUrls[0];
  const exportUrl = notices.length > general.length ? EXPORT_CERTIFICATE_GUIDE_URL : undefined;

  return certificateBanner({
    expired: notices.some((notice) => notice.expired),
    // Uno solo para todos los generales: el de renovar en produccion si son todos de produccion, si no la guia de siempre.
    guideUrl: generalUrl && exportUrl ? `${generalUrl}\nDe exportación: ${exportUrl}` : (generalUrl ?? exportUrl ?? ''),
    summary: notices.map((notice) => notice.summary).join('\n'),
  });
}

/**
 * Aviso de los certificados por vencer o vencidos, de cualquier entorno, al principio del comando. Va a stderr:
 * con `--json` stdout queda solo para el JSON. Si vencio el del entorno activo y hay `--json`, no se escribe: el
 * error JSON de `CERTIFICATE_EXPIRED` (tambien en stderr) ya lo dice, y un texto antes lo romperia.
 *
 * @internal Exportado para los tests.
 */
export function writeCertificateNotice(runtime: CertificateRuntime): void {
  if (runtime.certificateExpiry?.expired && runtime.outputJson) {
    return;
  }

  writeTerminalNotice(() => renderCertificateNotices(runtime.certificateNotices));
}

/** Lo que se suma a `avisos` en el JSON de facturacion. En texto el aviso ya salio arriba: no se repite. */
export function certificateWarnings(runtime: CertificateRuntime): string[] {
  return runtime.outputJson ? runtime.certificateNotices.map((notice) => notice.message) : [];
}

/** Con la config incompleta corta con su error, antes de tocar las carpetas. */
function assertProfileConfigured(config: ArcliConfig, environment: ArcliEnvironment): void {
  resolveCuit(config);
  credentialPaths(config, environment);
}

/**
 * Los tickets dan acceso a ARCA como este CUIT por unas horas: las carpetas de versiones viejas pasan a 0700, antes de
 * leer los certificados.
 */
function restrictProfileFolders(service: ConfigService, config: ArcliConfig): void {
  restrictFolderToOwner(dirname(service.getPath()));
  restrictFolderToOwner(service.resolveTicketPath(config));
}

/** Que el entorno se pueda usar, sin leer los certificados: la validacion de cada entorno de `config revisar` (el vencimiento lo muestra aparte). */
export function checkProfileFromConfig(config: ArcliConfig, environment: ArcliEnvironment): void {
  withConfigService((service) => {
    assertProfileConfigured(config, environment);
    restrictProfileFolders(service, config);
    checkArcaProfile(config, { environment });
  });
}

/**
 * Config, credenciales y salida, sin escribir el aviso del certificado: lo usa quien lo muestra a su manera (la barra
 * del modo interactivo) o no lo muestra.
 */
export function loadArcaRuntime(options: GlobalCliOptions): CliArcaRuntime {
  return withConfigService((service) => {
    const config = service.getConfig();
    const environment = resolveEnvironment(options, config);

    assertProfileConfigured(config, environment);
    restrictProfileFolders(service, config);

    return {
      ...loadArcaProfile(config, { environment, now: new Date(), ticketPath: service.resolveTicketPath(config) }),
      outputJson: options.json ?? config.output.jsonPorDefecto,
      outputRaw: options.bruto ?? config.output.brutoPorDefecto,
    };
  });
}

/**
 * Config, credenciales y aviso del certificado: el paso comun de los comandos que van a ARCA. En los de la E
 * (`wsfex`), el aviso habla del certificado que usa (`exportCertificateView`).
 */
export function resolveArcaRuntime(
  options: GlobalCliOptions,
  { service = 'wsfe' }: { readonly service?: 'wsfe' | 'wsfex' } = {},
): CliArcaRuntime {
  const runtime = loadArcaRuntime(options);

  writeCertificateNotice(service === 'wsfex' ? { ...runtime, ...exportCertificateView(runtime) } : runtime);

  return runtime;
}

/** `certificateWarnings` para la E. */
export function exportCertificateWarnings(
  runtime: CertificateRuntime & Pick<CliArcaRuntime, 'config' | 'environment'>,
): string[] {
  return certificateWarnings({ ...runtime, ...exportCertificateView(runtime) });
}
