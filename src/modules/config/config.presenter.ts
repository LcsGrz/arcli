import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { maskPath } from '../../lib/paths/mask-path';
import { keyValuePanel, renderKeyValueRows, resolveKeyValueLabelWidth, statusPanel, toneText } from '../../ui';

import type { ArcliConfig } from './config.schemas';
import type { ConfigDoctorReport } from './config-doctor';

interface PublicConfigSnapshot {
  readonly alicuota?: ArcliConfig['alicuotaPorDefecto'];
  readonly aliasCbu?: string;
  readonly cbu?: string;
  readonly cert: {
    readonly produccion?: string;
    readonly testing?: string;
  };
  readonly concepto?: ArcliConfig['conceptoPorDefecto'];
  readonly cotizacion?: number;
  readonly cuit?: string;
  readonly emisor: ArcliConfig['emisor'];
  readonly emitir: boolean;
  readonly entorno: 'produccion' | 'testing';
  readonly ivaReceptor?: ArcliConfig['ivaReceptorPorDefecto'];
  readonly json: boolean;
  readonly key: {
    readonly produccion?: string;
    readonly testing?: string;
  };
  readonly moneda?: string;
  readonly pdf: NonNullable<ArcliConfig['pdf']>;
  readonly pdfCarpeta: string;
  readonly pdfNavegador?: string;
  readonly puntoVenta?: number;
  readonly bruto: boolean;
  readonly ticketPath: string;
  readonly verificarFce?: boolean;
}

export interface ConfigPathSnapshot {
  readonly pdfFolder: string;
  readonly ticketPath: string;
}

function toPublicSnapshot(config: ArcliConfig, paths: ConfigPathSnapshot): PublicConfigSnapshot {
  return {
    alicuota: config.alicuotaPorDefecto,
    aliasCbu: config.aliasCbu,
    cbu: config.cbu,
    cert: {
      produccion: config.cert.produccion ? maskPath(config.cert.produccion) : undefined,
      testing: config.cert.testing ? maskPath(config.cert.testing) : undefined,
    },
    concepto: config.conceptoPorDefecto,
    cotizacion: config.cotizacionPorDefecto,
    cuit: config.cuit,
    emisor: { ...config.emisor, logo: config.emisor.logo ? maskPath(config.emisor.logo) : undefined },
    emitir: config.output.emitirPorDefecto,
    entorno: config.entornoPorDefecto,
    ivaReceptor: config.ivaReceptorPorDefecto,
    json: config.output.jsonPorDefecto,
    key: {
      produccion: config.key.produccion ? maskPath(config.key.produccion) : undefined,
      testing: config.key.testing ? maskPath(config.key.testing) : undefined,
    },
    moneda: config.monedaPorDefecto,
    pdf: config.pdf ?? 'preguntar',
    pdfCarpeta: maskPath(paths.pdfFolder),
    pdfNavegador: config.pdfNavegador ? maskPath(config.pdfNavegador) : undefined,
    puntoVenta: config.puntoVentaPorDefecto,
    bruto: config.output.brutoPorDefecto,
    ticketPath: maskPath(paths.ticketPath),
    verificarFce: config.verificarFce,
  };
}

export function formatConfig(config: ArcliConfig, paths: ConfigPathSnapshot): string {
  return JSON.stringify(toPublicSnapshot(config, paths), null, 2);
}

export function formatConfigPath(configPath: string): string {
  return configPath;
}

export function formatConfigAsText(config: ArcliConfig, paths: ConfigPathSnapshot): string {
  const safeConfig = toPublicSnapshot(config, paths);
  const rows: Array<readonly [string, string | number]> = [
    ['CUIT', safeConfig.cuit ?? 'no configurado'],
    ['CBU (FCE)', safeConfig.cbu ?? 'no configurado'],
    ['Alias CBU (FCE)', safeConfig.aliasCbu ?? 'no configurado'],
    ['Verificar regimen FCE', safeConfig.verificarFce ? 'si' : 'no'],
    ['Concepto', safeConfig.concepto ?? 'no configurado'],
    ['IVA receptor', safeConfig.ivaReceptor ?? 'no configurado'],
    ['Alicuota IVA (A y B)', safeConfig.alicuota ? `${safeConfig.alicuota}%` : '21% (por defecto)'],
    ['Moneda', safeConfig.moneda ?? 'PES'],
    ['Cotizacion', safeConfig.cotizacion ?? 1],
    ['Entorno', safeConfig.entorno],
    ['Cert testing', safeConfig.cert.testing ?? 'no configurado'],
    ['Key testing', safeConfig.key.testing ?? 'no configurado'],
    ['Cert produccion', safeConfig.cert.produccion ?? 'no configurado'],
    ['Key produccion', safeConfig.key.produccion ?? 'no configurado'],
    ['Punto de venta', safeConfig.puntoVenta ?? 'no configurado'],
    ['Emitir', safeConfig.emitir ? 'si' : 'no'],
    ['Salida JSON', safeConfig.json ? 'si' : 'no'],
    ['Salida bruta', safeConfig.bruto ? 'si' : 'no'],
    ['Ruta tickets WSAA', safeConfig.ticketPath],
    ['PDF', safeConfig.pdf],
    ['Carpeta de PDFs', safeConfig.pdfCarpeta],
    ['Navegador para PDFs', safeConfig.pdfNavegador ?? 'automatico'],
    ['Emisor: razon social', safeConfig.emisor.razonSocial ?? 'no configurado'],
    ['Emisor: domicilio', safeConfig.emisor.domicilio ?? 'no configurado'],
    [
      'Emisor: inicio actividades',
      safeConfig.emisor.inicioActividades
        ? formatArcaDateAsArgentineDate(safeConfig.emisor.inicioActividades)
        : 'no configurado',
    ],
    ['Emisor: IIBB', safeConfig.emisor.iibb ?? 'no configurado'],
    ['Emisor: condicion IVA', safeConfig.emisor.condicionIva ?? 'segun la letra'],
    ['Emisor: logo', safeConfig.emisor.logo ?? 'no configurado'],
  ];

  return keyValuePanel(
    'Configuracion',
    renderKeyValueRows(rows, { labelWidth: resolveKeyValueLabelWidth('standard', rows, [35, 65]) }),
    undefined,
    'standard',
    undefined,
    'sheet',
  );
}

export function formatConfigDoctor(report: ConfigDoctorReport): string {
  return JSON.stringify(
    {
      chequeos: report.checks.map((check) => ({
        categoria: check.category,
        detalle: check.detail,
        etiqueta: check.label,
      })),
      ok: report.ok,
    },
    null,
    2,
  );
}

export function formatConfigDoctorAsText(report: ConfigDoctorReport): string {
  const lines = report.checks.map((check) => {
    const icon =
      check.category === 'ok'
        ? toneText('✓', 'success')
        : check.category === 'warning'
          ? toneText('!', 'warning')
          : toneText('x', 'danger');

    return `${icon} ${check.label}: ${check.detail}`;
  });
  const tone = report.ok ? 'success' : report.checks.some((check) => check.category === 'error') ? 'danger' : 'warning';
  const footer = report.ok
    ? 'Configuracion lista para usar ARCLI'
    : report.checks.some((check) => check.category === 'error')
      ? 'Hay puntos criticos por corregir antes de emitir'
      : 'Revise las recomendaciones antes de emitir en serio';

  return statusPanel('Revision de configuracion', lines, footer, 'wide', tone, 'checklist');
}
