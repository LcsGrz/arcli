import { maskPath } from '../../lib/paths/mask-path';
import { keyValuePanel, renderKeyValueRows, resolveBalancedKeyValueLabelWidth, statusPanel, toneText } from '../../ui';

import type { ArcliConfig } from './config.schemas';
import type { ConfigDoctorReport } from './config-doctor';

interface PublicConfigSnapshot {
  readonly cert: {
    readonly produccion?: string;
    readonly testing?: string;
  };
  readonly concepto?: ArcliConfig['conceptoPorDefecto'];
  readonly cotizacion?: number;
  readonly cuit?: string;
  readonly emitir: boolean;
  readonly entorno: 'produccion' | 'testing';
  readonly ivaReceptor?: ArcliConfig['ivaReceptorPorDefecto'];
  readonly json: boolean;
  readonly key: {
    readonly produccion?: string;
    readonly testing?: string;
  };
  readonly moneda?: string;
  readonly puntoVenta?: number;
  readonly bruto: boolean;
  readonly ticketPath: string;
}

function toPublicSnapshot(config: ArcliConfig, effectiveTicketPath: string): PublicConfigSnapshot {
  return {
    cert: {
      produccion: config.cert.produccion ? maskPath(config.cert.produccion) : undefined,
      testing: config.cert.testing ? maskPath(config.cert.testing) : undefined,
    },
    concepto: config.conceptoPorDefecto,
    cotizacion: config.cotizacionPorDefecto,
    cuit: config.cuit,
    emitir: config.output.emitirPorDefecto,
    entorno: config.entornoPorDefecto,
    ivaReceptor: config.ivaReceptorPorDefecto,
    json: config.output.jsonPorDefecto,
    key: {
      produccion: config.key.produccion ? maskPath(config.key.produccion) : undefined,
      testing: config.key.testing ? maskPath(config.key.testing) : undefined,
    },
    moneda: config.monedaPorDefecto,
    puntoVenta: config.puntoVentaPorDefecto,
    bruto: config.output.brutoPorDefecto,
    ticketPath: maskPath(effectiveTicketPath),
  };
}

export function formatConfig(config: ArcliConfig, effectiveTicketPath: string): string {
  return JSON.stringify(toPublicSnapshot(config, effectiveTicketPath), null, 2);
}

export function formatConfigPath(configPath: string): string {
  return configPath;
}

export function formatConfigAsText(config: ArcliConfig, effectiveTicketPath: string): string {
  const safeConfig = toPublicSnapshot(config, effectiveTicketPath);
  const labelWidth = resolveBalancedKeyValueLabelWidth('standard');

  return keyValuePanel(
    'Configuracion',
    renderKeyValueRows(
      [
        ['CUIT', safeConfig.cuit ?? 'no configurado'],
        ['Concepto', safeConfig.concepto ?? 'no configurado'],
        ['IVA receptor', safeConfig.ivaReceptor ?? 'no configurado'],
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
      ],
      { labelWidth },
    ),
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

  return statusPanel('Revision de configuracion', lines, footer, 'wide', tone);
}
