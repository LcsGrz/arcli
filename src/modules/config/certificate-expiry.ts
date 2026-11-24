import { readFileSync } from 'node:fs';

import { formatArcaDateAsArgentineDate, formatDateAsArcaDate } from '../../lib/dates/arca-date';
import { AppError } from '../../lib/errors/app-error';
import { certificateRenewalGuideUrl, EXPORT_CERTIFICATE_GUIDE_URL } from '../../lib/links';
import {
  type CertificateExpiry,
  isCertificateExpiringSoon,
  readCertificateExpiry,
} from '../../lib/security/certificate';

import {
  type ArcliConfig,
  type ArcliEnvironment,
  arcliEnvironmentSchema,
  formatEnvironmentLabel,
} from './config.schemas';

/** A menos de estos dias de vencer, el certificado se avisa en cada comando y en `config revisar`. */
export const CERTIFICATE_EXPIRY_WARNING_DAYS = 30;

/** El propio de WSFEX (`exportacion.cert`); sin definir, el general (`cert`). */
type CertificateUse = 'exportacion';

/** Aviso de un certificado por vencer o vencido. Sin aviso, el certificado esta lejos de vencer (o no se pudo leer). */
export interface CertificateExpiryNotice {
  readonly daysRemaining: number;
  readonly environment: ArcliEnvironment;
  readonly expired: boolean;
  /** dd/mm/aaaa, en hora argentina. */
  readonly expiresOn: string;
  /** Una linea, con el link a la guia: va tal cual en `avisos` del JSON. */
  readonly message: string;
  /** El aviso sin el link, para el banner (que muestra el link en su propia linea). */
  readonly summary: string;
  readonly use?: CertificateUse;
}

/** Fecha de vencimiento como dd/mm/aaaa del dia en Argentina. */
export function formatCertificateExpiryDate(expiresAt: Date): string {
  return formatArcaDateAsArgentineDate(formatDateAsArcaDate(expiresAt));
}

function formatDaysRemaining(days: number): string {
  if (days <= 0) {
    return 'hoy';
  }

  return days === 1 ? 'en 1 día' : `en ${days} días`;
}

/** `El certificado de testing`, `El certificado de exportación de testing`. */
function certificateSubject(environment: ArcliEnvironment, use?: CertificateUse): string {
  return `El certificado ${use === 'exportacion' ? 'de exportación ' : ''}de ${formatEnvironmentLabel(environment)}`;
}

/** Adonde mandar a renovarlo: el de exportacion no se renueva con `arcli certificado`. */
export function renewalGuideUrl(notice: Pick<CertificateExpiryNotice, 'environment' | 'use'>): string {
  return notice.use === 'exportacion' ? EXPORT_CERTIFICATE_GUIDE_URL : certificateRenewalGuideUrl(notice.environment);
}

/** @internal Exportado para los tests. */
export function describeCertificateExpiry(
  expiry: CertificateExpiry,
  environment: ArcliEnvironment,
  use?: CertificateUse,
): CertificateExpiryNotice | undefined {
  if (!expiry.isExpired && !isCertificateExpiringSoon(expiry, CERTIFICATE_EXPIRY_WARNING_DAYS)) {
    return undefined;
  }

  const expiresOn = formatCertificateExpiryDate(expiry.expiresAt);
  const status = expiry.isExpired
    ? `venció el ${expiresOn}`
    : `vence el ${expiresOn} (${formatDaysRemaining(expiry.daysRemaining)})`;

  const summary = `${certificateSubject(environment, use)} ${status}.`;

  return {
    daysRemaining: expiry.daysRemaining,
    environment,
    expired: expiry.isExpired,
    expiresOn,
    message: `${summary} Renovalo: ${renewalGuideUrl({ environment, use })}`,
    summary,
    ...(use ? { use } : {}),
  };
}

/**
 * Aviso del certificado ya leido (PEM). Si no se puede leer la fecha, no hay aviso: el error de un certificado
 * invalido lo informa el flujo de siempre (WSAA o `config revisar`).
 */
export function inspectCertificateExpiry(
  pemContent: string,
  environment: ArcliEnvironment,
  now: Date,
  use?: CertificateUse,
): CertificateExpiryNotice | undefined {
  try {
    return describeCertificateExpiry(readCertificateExpiry(pemContent, now), environment, use);
  } catch {
    return undefined;
  }
}

export interface ConfiguredCertificatesOptions {
  readonly activeEnvironment: ArcliEnvironment;
  /** El PEM del entorno activo, si ya se leyo para el contexto: no se vuelve a leer el archivo. */
  readonly activePem?: string;
  readonly now: Date;
}

/**
 * Avisos de todos los certificados configurados (los generales y los de exportacion, de testing y produccion), sin
 * importar con cual se trabaja: quien factura en testing tambien tiene que enterarse de que vence el de produccion. El
 * del entorno activo va primero. Un certificado sin configurar o que no se puede leer no avisa, y uno de exportacion
 * que es el mismo archivo que el general no se repite.
 */
export function inspectConfiguredCertificates(
  config: Partial<Pick<ArcliConfig, 'cert' | 'exportacion'>>,
  options: ConfiguredCertificatesOptions,
): CertificateExpiryNotice[] {
  const environments = arcliEnvironmentSchema.options.filter(
    (environment) => environment !== options.activeEnvironment,
  );

  return [options.activeEnvironment, ...environments].flatMap((environment) => {
    const pem = environment === options.activeEnvironment ? options.activePem : undefined;
    const certificates = [
      { content: pem ?? readCertificateQuietly(config.cert?.[environment]), use: undefined },
      { content: readCertificateQuietly(ownExportCertificate(config, environment)), use: 'exportacion' },
    ] as const;

    return certificates.flatMap(({ content, use }) => {
      const notice =
        content === undefined ? undefined : inspectCertificateExpiry(content, environment, options.now, use);

      return notice ? [notice] : [];
    });
  });
}

/**
 * El certificado propio de WSFEX, si no es el mismo archivo que el general. Solo con el par completo: a medias, la E
 * corta antes (`resolveExportCredentials`).
 */
function ownExportCertificate(
  config: Partial<Pick<ArcliConfig, 'cert' | 'exportacion'>>,
  environment: ArcliEnvironment,
): string | undefined {
  const cert = config.exportacion?.key?.[environment] ? config.exportacion.cert?.[environment] : undefined;

  return cert === config.cert?.[environment] ? undefined : cert;
}

/** Los avisos del vencimiento de los certificados, y el del que se usa, si vence o vencio. */
interface CertificateExpiryView {
  readonly certificateExpiry?: CertificateExpiryNotice;
  readonly certificateNotices: readonly CertificateExpiryNotice[];
}

/**
 * Los avisos como los muestra un comando de la E. Con par propio, el certificado que usa es ese: el general del mismo
 * entorno no se avisa. Solo para mostrar: lo que exige el perfil no cambia.
 */
export function exportCertificateView(
  profile: CertificateExpiryView & {
    readonly config: Partial<Pick<ArcliConfig, 'cert' | 'exportacion'>>;
    readonly environment: ArcliEnvironment;
  },
): CertificateExpiryView {
  const { certificateExpiry, certificateNotices, config, environment } = profile;

  if (!ownExportCertificate(config, environment)) {
    return { certificateExpiry, certificateNotices };
  }

  const notices = certificateNotices.filter(
    (notice) => notice.environment !== environment || notice.use === 'exportacion',
  );

  return {
    certificateExpiry: notices.find((notice) => notice.environment === environment),
    certificateNotices: notices,
  };
}

function readCertificateQuietly(filePath: string | undefined): string | undefined {
  if (!filePath) {
    return undefined;
  }

  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

/** Con el certificado vencido WSAA rechaza el login: se corta antes, sin ir a ARCA. */
export class CertificateExpiredError extends AppError {
  public readonly notice: CertificateExpiryNotice;

  public constructor(notice: CertificateExpiryNotice) {
    super(`${certificateSubject(notice.environment, notice.use)} venció el ${notice.expiresOn}: ARCA no lo acepta.`, {
      code: 'CERTIFICATE_EXPIRED',
      details: { entorno: notice.environment, vencimiento: notice.expiresOn },
      suggestion: `${
        notice.use === 'exportacion'
          ? `Sacá uno nuevo en ARCA, autorizalo a \`wsfex\` y cargá el .crt con \`arcli config establecer exportacion.cert.${notice.environment} <ruta>\` (si cambió la clave, también \`exportacion.key.${notice.environment}\`).`
          : `Renovalo con \`arcli certificado generar --${notice.environment}\` y cargá el .crt de ARCA con \`arcli certificado importar <archivo>\`.`
      } Guía: ${renewalGuideUrl(notice)}`,
    });
    this.name = 'CertificateExpiredError';
    this.notice = notice;
  }
}
