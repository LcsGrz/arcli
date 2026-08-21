import { isCertificateExpiringSoon, readCertificateExpiry } from '../../lib/security/certificate';
import { readPemFile } from '../../lib/security/pem';
import type { ArcaRuntimeValidation } from '../../services/arca/arca-context.resolver';

import type { ArcliConfig } from './config.schemas';

const CERTIFICATE_EXPIRY_WARNING_DAYS = 30;

export interface ConfigDoctorReport {
  readonly checks: ReadonlyArray<{
    readonly category: 'error' | 'ok' | 'warning';
    readonly detail: string;
    readonly label: string;
  }>;
  readonly ok: boolean;
}

export interface ConfigDoctorRuntimeCheck {
  readonly error?: string;
  readonly validation?: ArcaRuntimeValidation;
}

function buildCertificateExpiryCheck(
  label: string,
  certPath: string | undefined,
): ConfigDoctorReport['checks'][number] | null {
  if (!certPath) {
    return null;
  }

  try {
    const pemContent = readPemFile(certPath, 'certificado');
    const expiry = readCertificateExpiry(pemContent);
    const formattedDate = expiry.expiresAt.toLocaleDateString('es-AR');

    if (expiry.isExpired) {
      return { category: 'error', detail: `El certificado vencio el ${formattedDate}.`, label };
    }

    if (isCertificateExpiringSoon(expiry, CERTIFICATE_EXPIRY_WARNING_DAYS)) {
      return {
        category: 'warning',
        detail: `El certificado vence en ${expiry.daysRemaining} dias (${formattedDate}). Renuevelo pronto.`,
        label,
      };
    }

    return { category: 'ok', detail: `El certificado vence el ${formattedDate}.`, label };
  } catch (error) {
    return {
      category: 'warning',
      detail: `No se pudo verificar el vencimiento del certificado: ${error instanceof Error ? error.message : String(error)}`,
      label,
    };
  }
}

export function buildConfigDoctorReport(
  config: ArcliConfig,
  runtimeCheck?: ConfigDoctorRuntimeCheck,
): ConfigDoctorReport {
  const checks: Array<ConfigDoctorReport['checks'][number]> = [];

  const conditionalChecks: ReadonlyArray<{
    readonly label: string;
    readonly ok: unknown;
    readonly okDetail: string;
    readonly warningDetail: string;
  }> = [
    {
      label: 'CUIT',
      ok: config.cuit,
      okDetail: 'CUIT listo para emitir comprobantes.',
      warningDetail: 'Configure su CUIT con "arcli config establecer cuit <valor>".',
    },
    {
      label: 'Punto de venta',
      ok: config.puntoVentaPorDefecto,
      okDetail: `Punto de venta por defecto: ${config.puntoVentaPorDefecto}.`,
      warningDetail: 'Configure un punto de venta por defecto con "arcli config establecer puntoVenta <valor>".',
    },
    {
      label: 'Concepto',
      ok: config.conceptoPorDefecto,
      okDetail: `Concepto por defecto: ${config.conceptoPorDefecto}.`,
      warningDetail: 'Puede fijar un concepto por defecto con "arcli config establecer concepto servicios".',
    },
    {
      label: 'IVA receptor',
      ok: config.ivaReceptorPorDefecto,
      okDetail: `IVA receptor por defecto: ${config.ivaReceptorPorDefecto}.`,
      warningDetail:
        'Puede fijar un IVA receptor por defecto con "arcli config establecer ivaReceptor consumidor-final".',
    },
    {
      label: 'Credenciales testing',
      ok: config.cert.testing && config.key.testing,
      okDetail: 'Certificado y clave de testing configurados.',
      warningDetail:
        'Faltan credenciales de testing. Configure "cert.testing" y "key.testing" con "arcli config establecer".',
    },
    {
      label: 'Credenciales produccion',
      ok: config.cert.produccion && config.key.produccion,
      okDetail: 'Certificado y clave de produccion configurados.',
      warningDetail:
        'Todavia no hay credenciales de produccion configuradas. Puede cargarlas con "cert.produccion" y "key.produccion".',
    },
  ];

  for (const check of conditionalChecks) {
    checks.push(
      check.ok
        ? { category: 'ok', detail: check.okDetail, label: check.label }
        : { category: 'warning', detail: check.warningDetail, label: check.label },
    );
  }

  for (const [label, certPath] of [
    ['Vencimiento cert. testing', config.cert.testing],
    ['Vencimiento cert. produccion', config.cert.produccion],
  ] as const) {
    const certificateCheck = buildCertificateExpiryCheck(label, certPath);

    if (certificateCheck) {
      checks.push(certificateCheck);
    }
  }

  checks.push({
    category: 'ok',
    detail: `Entorno por defecto: ${config.entornoPorDefecto}.`,
    label: 'Entorno',
  });

  checks.push({
    category: 'ok',
    detail: `Emitir por defecto: ${config.output.emitirPorDefecto ? 'si' : 'no'}.`,
    label: 'Emision',
  });

  checks.push({
    category: 'ok',
    detail: `Salida JSON por defecto: ${config.output.jsonPorDefecto ? 'si' : 'no'}.`,
    label: 'JSON',
  });

  checks.push({
    category: 'ok',
    detail: `Respuesta bruta por defecto: ${config.output.brutoPorDefecto ? 'si' : 'no'}.`,
    label: 'Bruto',
  });

  if (runtimeCheck?.validation) {
    checks.push({
      category: 'ok',
      detail: `Configuracion valida para ${runtimeCheck.validation.environment}.`,
      label: 'Revision activa',
    });
  } else if (runtimeCheck?.error) {
    checks.push({
      category: 'error',
      detail: runtimeCheck.error,
      label: 'Revision activa',
    });
  }

  return {
    checks,
    ok: checks.every((check) => check.category === 'ok'),
  };
}
