import { isCertificateExpiringSoon, readCertificateExpiry } from '../../lib/security/certificate';
import { readPemFile } from '../../lib/security/pem';
import { listMissingIssuerKeys } from '../pdf/pdf-issuer';

import { CERTIFICATE_EXPIRY_WARNING_DAYS, formatCertificateExpiryDate } from './certificate-expiry';
import {
  type ArcliConfig,
  type ArcliEnvironment,
  arcliEnvironmentSchema,
  formatEnvironmentLabel,
} from './config.schemas';

/** Como se agrupan los chequeos en el texto de `config revisar`, en este orden; el JSON no las lleva. */
export const CONFIG_DOCTOR_SECTIONS = [
  ['cuenta', 'Cuenta'],
  ['facturacion', 'Al facturar'],
  ['certificados', 'Certificados'],
  ['salida', 'Salida'],
  ['pdf', 'PDF'],
  ['validaciones', 'Validaciones'],
] as const;

export type ConfigDoctorSection = (typeof CONFIG_DOCTOR_SECTIONS)[number][0];

export interface ConfigDoctorReport {
  readonly checks: ReadonlyArray<{
    readonly category: 'error' | 'ok' | 'warning';
    /** Se lee solo, sin la etiqueta: el texto lo muestra como un item de su seccion. */
    readonly detail: string;
    readonly label: string;
    readonly section: ConfigDoctorSection;
    /** El dato del chequeo dentro de `detail` (un valor, una fecha, el entorno): el texto lo resalta. */
    readonly value?: string;
  }>;
  readonly ok: boolean;
}

/** Lo que valida `ArcaContextResolver` para un entorno: CUIT, certificado y clave legibles. */
export interface ConfigDoctorRuntimeCheck {
  readonly environment: ArcliEnvironment;
  /** Sin error, el entorno esta listo. */
  readonly error?: string;
}

function buildCertificateExpiryCheck(
  label: string,
  name: string,
  certPath: string | undefined,
): ConfigDoctorReport['checks'][number] | null {
  if (!certPath) {
    return null;
  }

  try {
    const pemContent = readPemFile(certPath, 'certificado');
    const expiry = readCertificateExpiry(pemContent);
    const formattedDate = formatCertificateExpiryDate(expiry.expiresAt);

    if (expiry.isExpired) {
      return {
        category: 'error',
        detail: `El ${name} venció el ${formattedDate}.`,
        label,
        section: 'certificados',
        value: formattedDate,
      };
    }

    if (isCertificateExpiringSoon(expiry, CERTIFICATE_EXPIRY_WARNING_DAYS)) {
      return {
        category: 'warning',
        detail: `El ${name} vence en ${expiry.daysRemaining} días (${formattedDate}). Renovalo con "arcli certificado generar".`,
        label,
        section: 'certificados',
        value: formattedDate,
      };
    }

    return {
      category: 'ok',
      detail: `El ${name} vence el ${formattedDate}.`,
      label,
      section: 'certificados',
      value: formattedDate,
    };
  } catch (error) {
    return {
      category: 'warning',
      detail: `No se pudo verificar el vencimiento del ${name}: ${error instanceof Error ? error.message : String(error)}`,
      label,
      section: 'certificados',
    };
  }
}

export function buildConfigDoctorReport(
  config: ArcliConfig,
  runtimeChecks: readonly ConfigDoctorRuntimeCheck[] = [],
): ConfigDoctorReport {
  const checks: Array<ConfigDoctorReport['checks'][number]> = [];

  const conditionalChecks: ReadonlyArray<{
    readonly label: string;
    readonly ok: unknown;
    readonly okDetail: string;
    readonly section: ConfigDoctorSection;
    readonly value?: string;
    readonly warningDetail: string;
  }> = [
    {
      label: 'CUIT',
      section: 'cuenta',
      ok: config.cuit,
      okDetail: 'CUIT listo para emitir comprobantes.',
      warningDetail: 'Configurá su CUIT con "arcli config establecer cuit <valor>".',
    },
    {
      label: 'Punto de venta',
      section: 'cuenta',
      ok: config.puntoVentaPorDefecto,
      okDetail: `Punto de venta por defecto: ${config.puntoVentaPorDefecto}.`,
      value: String(config.puntoVentaPorDefecto),
      warningDetail: 'Configurá un punto de venta por defecto con "arcli config establecer puntoVenta <valor>".',
    },
    {
      label: 'Concepto',
      section: 'facturacion',
      ok: config.conceptoPorDefecto,
      okDetail: `Concepto por defecto: ${config.conceptoPorDefecto}.`,
      value: config.conceptoPorDefecto,
      warningDetail: 'Podés fijar un concepto por defecto con "arcli config establecer concepto servicios".',
    },
    {
      label: 'IVA receptor',
      section: 'facturacion',
      ok: config.ivaReceptorPorDefecto,
      okDetail: `IVA receptor por defecto: ${config.ivaReceptorPorDefecto}.`,
      value: config.ivaReceptorPorDefecto,
      warningDetail:
        'Podés fijar un IVA receptor por defecto con "arcli config establecer ivaReceptor consumidor-final".',
    },
    {
      label: 'Credenciales testing',
      section: 'certificados',
      ok: config.cert.testing && config.key.testing,
      okDetail: 'Certificado y clave de testing configurados.',
      value: 'testing',
      warningDetail:
        'Faltan el certificado y la clave de testing: sacalos con "arcli certificado generar --testing", o configurá "cert.testing" y "key.testing".',
    },
    {
      label: 'Credenciales producción',
      section: 'certificados',
      ok: config.cert.produccion && config.key.produccion,
      okDetail: 'Certificado y clave de producción configurados.',
      value: 'producción',
      warningDetail:
        'Todavía no hay certificado de producción: sacalo con "arcli certificado generar --produccion", o configurá "cert.produccion" y "key.produccion".',
    },
  ];

  for (const check of conditionalChecks) {
    checks.push(
      check.ok
        ? { category: 'ok', detail: check.okDetail, label: check.label, section: check.section, value: check.value }
        : { category: 'warning', detail: check.warningDetail, label: check.label, section: check.section },
    );
  }

  for (const [label, name, certPath] of [
    ['Vencimiento cert. testing', 'certificado de testing', config.cert.testing],
    ['Vencimiento cert. producción', 'certificado de producción', config.cert.produccion],
    [
      'Vencimiento cert. exportación testing',
      'certificado de exportación de testing',
      config.exportacion?.cert.testing,
    ],
    [
      'Vencimiento cert. exportación producción',
      'certificado de exportación de producción',
      config.exportacion?.cert.produccion,
    ],
  ] as const) {
    const certificateCheck = buildCertificateExpiryCheck(label, name, certPath);

    if (certificateCheck) {
      checks.push(certificateCheck);
    }
  }

  // WSFEX es opcional: solo se avisa si hay algo configurado a medias.
  for (const environment of arcliEnvironmentSchema.options) {
    const cert = config.exportacion?.cert[environment];
    const key = config.exportacion?.key[environment];

    if (!cert && !key) {
      continue;
    }

    checks.push(
      cert && key
        ? {
            category: 'ok',
            detail: `Certificado y clave de exportación (${environment}) configurados.`,
            label: 'Credenciales WSFEX',
            section: 'certificados',
            value: environment,
          }
        : {
            category: 'warning',
            detail: `Para WSFEX en ${environment} configurá "exportacion.cert.${environment}" y "exportacion.key.${environment}" juntos.`,
            label: 'Credenciales WSFEX',
            section: 'certificados',
          },
    );
  }

  checks.push({
    category: 'ok',
    detail: `Entorno por defecto: ${config.entornoPorDefecto}.`,
    label: 'Entorno',
    section: 'salida',
    value: config.entornoPorDefecto,
  });

  checks.push({
    category: 'ok',
    detail: `Emitir por defecto: ${config.output.emitirPorDefecto ? 'si' : 'no'}.`,
    label: 'Emisión',
    section: 'salida',
    value: config.output.emitirPorDefecto ? 'si' : 'no',
  });

  checks.push({
    category: 'ok',
    detail: `Salida JSON por defecto: ${config.output.jsonPorDefecto ? 'si' : 'no'}.`,
    label: 'JSON',
    section: 'salida',
    value: config.output.jsonPorDefecto ? 'si' : 'no',
  });

  checks.push({
    category: 'ok',
    detail: `Respuesta bruta por defecto: ${config.output.brutoPorDefecto ? 'si' : 'no'}.`,
    label: 'Bruto',
    section: 'salida',
    value: config.output.brutoPorDefecto ? 'si' : 'no',
  });

  // Solo se avisa si el PDF se genera siempre: con "preguntar" (por defecto) los datos se piden al generarlo.
  const missingIssuerKeys = listMissingIssuerKeys(config);

  if (missingIssuerKeys.length === 0) {
    checks.push({ category: 'ok', detail: 'Datos del emisor completos para el PDF.', label: 'PDF', section: 'pdf' });
  } else if (config.pdf === 'siempre') {
    checks.push({
      category: 'warning',
      detail: `Con pdf=siempre faltan datos del emisor: ${missingIssuerKeys.join(', ')}. Configuralos con "arcli config establecer".`,
      label: 'PDF',
      section: 'pdf',
    });
  }

  for (const runtimeCheck of runtimeChecks) {
    const environment = formatEnvironmentLabel(runtimeCheck.environment);
    const label = `Validación ${environment}`;

    checks.push(
      runtimeCheck.error
        ? { category: 'error', detail: runtimeCheck.error, label, section: 'validaciones' }
        : {
            category: 'ok',
            detail: `Configuración válida para ${environment}.`,
            label,
            section: 'validaciones',
            value: environment,
          },
    );
  }

  return {
    checks,
    ok: checks.every((check) => check.category === 'ok'),
  };
}
