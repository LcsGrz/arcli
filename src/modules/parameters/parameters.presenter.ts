import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { DEPRECATED_POINT_OF_SALE_OBJECT } from '../../lib/json/deprecations';
import { POINT_OF_SALE_GUIDE_URL } from '../../lib/links';
import { formatExchangeRate } from '../../lib/numbers/argentine-amount';
import { formatTableRows, listingPanel, noticePanel, sheetPanel } from '../../ui/components';
import { bold, renderKeyValueRows, resolveKeyValueLabelWidth, uiSymbol } from '../../ui/primitives';
import { formatEnvironmentLabel } from '../config/config.schemas';

import {
  PARAMETER_TABLE_NAMES,
  PARAMETER_TABLES,
  type ParameterEntry,
  type ParameterTable,
  type Quotation,
  type ServerStatus,
} from './parameters';
import { areServersOk } from './server-status';
import type { PointOfSaleCheck, StatusReport } from './status';

type Environment = 'produccion' | 'testing';

/** Un servidor del que ARCA no devolvio el estado: la fila va igual, es lo que se consulta. */
const NO_SERVER_STATUS = 'ARCA no lo informa';

export function formatParameterTablesAsText(): string {
  const rows = PARAMETER_TABLE_NAMES.map((name) => [name, PARAMETER_TABLES[name]] as const);
  const allRows = [...rows, ['cotización <moneda>', 'Cotización oficial de ARCA, por ejemplo USD'] as const];

  return sheetPanel(
    'Tablas de ARCA',
    renderKeyValueRows(allRows, { labelWidth: resolveKeyValueLabelWidth('standard', allRows) }),
    { footer: 'Uso: `arcli parametros <tabla>`' },
  );
}

export function serializeParameterTables() {
  return {
    tablas: [
      ...PARAMETER_TABLE_NAMES.map((name) => ({ descripcion: PARAMETER_TABLES[name], tabla: name })),
      { descripcion: 'Cotización oficial de ARCA', tabla: 'cotizacion' },
    ],
  };
}

export function formatParameterEntriesAsText(
  table: ParameterTable,
  entries: readonly ParameterEntry[],
  environment: Environment,
): string {
  if (entries.length === 0) {
    const reason =
      table === 'puntos-venta' && environment === 'testing'
        ? 'En testing ARCA no informa puntos de venta: cualquier número sirve para probar.'
        : `ARCA no devolvió valores para ${PARAMETER_TABLES[table].toLowerCase()}.`;

    return noticePanel(reason, 'muted');
  }

  const { header, rows } = formatParameterRows(table, entries);

  return listingPanel(
    `${PARAMETER_TABLES[table]} ${uiSymbol('separator')} ${formatEnvironmentLabel(environment)}`,
    [bold(header), ...rows],
    { legend: PARAMETER_TABLE_LEGEND[table] },
  );
}

/** Encabezado de cada columna: la de la izquierda es el codigo; la tercera, solo en las tablas que tienen detalle. */
const PARAMETER_TABLE_COLUMNS: Record<ParameterTable, readonly [id: string, description: string, detail?: string]> = {
  alicuotas: ['CÓDIGO', 'ALÍCUOTA'],
  comprobantes: ['CÓDIGO', 'COMPROBANTE'],
  conceptos: ['CÓDIGO', 'CONCEPTO'],
  documentos: ['CÓDIGO', 'DOCUMENTO'],
  'iva-receptor': ['CÓDIGO', 'CONDICIÓN', 'COMPROBANTES'],
  monedas: ['CÓDIGO', 'MONEDA'],
  opcionales: ['CÓDIGO', 'DATO OPCIONAL'],
  'puntos-venta': ['NÚMERO', 'TIPO DE EMISIÓN', 'ESTADO'],
  tributos: ['CÓDIGO', 'TRIBUTO'],
};

/**
 * Para que sirve el codigo de cada tabla en ARCLI, una idea por linea: va en la leyenda, debajo del listado. La
 * ayuda del asistente las junta en una (`PARAMETER_TABLE_HELP`).
 */
export const PARAMETER_TABLE_LEGEND: Record<ParameterTable, readonly string[]> = {
  alicuotas: ['`--alicuota` va con la tasa (`21`, `10.5`), no con el código.'],
  comprobantes: ['ARCLI los elige por atajo (`fc`, `nca`); el código es el de `--at`, el tipo del asociado.'],
  conceptos: ['`--concepto` va con el nombre: `productos`, `servicios` o `productos-servicios`.'],
  documentos: ['El documento del receptor: en ARCLI va con `--cuit`, `--cuil`, `--dni` o `--cfinal`.'],
  'iva-receptor': [
    '`--ir` va con el nombre (`responsable-inscripto`) o un atajo (`--ir-ri`).',
    'Comprobantes: las letras que la admiten.',
  ],
  monedas: ['`--moneda` acepta este código o el ISO: `060` o `EUR`.'],
  opcionales: [
    'Datos que ARCA acepta además de los básicos.',
    'ARCLI completa solo los que usa, como el CBU de la FCE.',
  ],
  'puntos-venta': ['El número va en `--pv` o en la config (`puntoVenta`). Solo sirven los de web service.'],
  tributos: ['ARCLI todavía no informa tributos, como las percepciones de IIBB.'],
};

/** La leyenda de cada tabla en una linea: la descripcion de cada tabla en el asistente y la ayuda de su lista. */
export const PARAMETER_TABLE_HELP = Object.fromEntries(
  Object.entries(PARAMETER_TABLE_LEGEND).map(([table, legend]) => [table, legend.join(' ')]),
) as Record<ParameterTable, string>;

/**
 * Filas alineadas de una tabla de ARCA con su encabezado: codigo, descripcion y, si la tabla lo tiene, el detalle.
 * Las usan el listado de `arcli parametros` y la lista filtrable del asistente.
 */
export function formatParameterRows(
  table: ParameterTable,
  entries: readonly ParameterEntry[],
): { readonly header: string; readonly rows: string[] } {
  const [idTitle, descriptionTitle, detailTitle] = PARAMETER_TABLE_COLUMNS[table];
  const hasDetail = detailTitle !== undefined && entries.some((entry) => entry.detail);

  return hasDetail
    ? formatTableRows(
        [idTitle, descriptionTitle, detailTitle],
        entries.map((entry) => [entry.id, entry.description, entry.detail ?? '']),
      )
    : formatTableRows(
        [idTitle, descriptionTitle],
        entries.map((entry) => [entry.id, entry.description]),
      );
}

export function serializeParameterEntries(
  table: ParameterTable,
  entries: readonly ParameterEntry[],
  environment: Environment,
) {
  return {
    entorno: environment,
    tabla: table,
    valores: entries.map((entry) => ({
      descripcion: entry.description,
      detalle: entry.detail ?? null,
      id: entry.id,
      vigenteHasta: entry.validTo ?? null,
    })),
  };
}

/**
 * Con `currencyName` (la descripcion de la tabla de monedas, si ya se tiene), la moneda sale con su nombre:
 * "Euro (060)". ARCA no lo manda con la cotizacion, y pedirlo aparte cuesta otra consulta.
 */
export function formatQuotationAsText(
  quotation: Quotation,
  environment: Environment,
  options: { readonly currencyName?: string } = {},
): string {
  const name = options.currencyName?.trim();
  const rows = [
    ['Moneda', name ? `${name} (${quotation.currency})` : quotation.currency],
    ['Cotización', formatExchangeRate(quotation.rate)],
    ['Fecha', quotation.date ? formatArcaDateAsArgentineDate(quotation.date) : undefined],
  ] as const;

  return sheetPanel(
    `Cotización oficial ${uiSymbol('separator')} ${formatEnvironmentLabel(environment)}`,
    renderKeyValueRows(rows, { labelWidth: resolveKeyValueLabelWidth('standard', rows) }),
  );
}

export function serializeQuotation(quotation: Quotation, environment: Environment) {
  return {
    cotizacion: quotation.rate,
    entorno: environment,
    fecha: quotation.date ?? null,
    moneda: quotation.currency,
  };
}

function describePointOfSale(check: PointOfSaleCheck, number: number | undefined): string {
  switch (check.kind) {
    case 'habilitado':
      return `${number} habilitado (${check.point.emissionType})`;
    case 'bloqueado':
      return `${number} bloqueado en ARCA`;
    case 'de-baja':
      return `${number} dado de baja`;
    case 'no-encontrado':
      return `${number} no está habilitado para web service en este CUIT`;
    case 'sin-datos':
      return `${number} (en testing ARCA no informa puntos de venta)`;
    case 'sin-configurar':
      return 'sin configurar';
  }
}

/** Una linea sola: `OK` o los que no lo estan. */
function describeExportServers(servers: ServerStatus | undefined): string {
  if (!servers) {
    return 'sin respuesta';
  }

  if (areServersOk(servers)) {
    return servers.app;
  }

  return [
    ['aplicación', servers.app],
    ['base de datos', servers.db],
    ['autenticación', servers.auth],
  ]
    .filter(([, value]) => value !== 'OK')
    .map(([label, value]) => `${label}: ${value || NO_SERVER_STATUS}`)
    .join(', ');
}

export function formatStatusAsText(report: StatusReport): string {
  const rows = [
    ['Entorno', formatEnvironmentLabel(report.environment)],
    ['Servidor de aplicación', report.servers.app || NO_SERVER_STATUS],
    ['Base de datos', report.servers.db || NO_SERVER_STATUS],
    ['Autenticación', report.servers.auth || NO_SERVER_STATUS],
    ['Exportación (WSFEX)', describeExportServers(report.exportServers)],
    ['Tiempo de respuesta', `${report.latencyMs} ms`],
    ['Punto de venta', describePointOfSale(report.pointOfSale, report.pointOfSaleNumber)],
  ] as const;
  const footer = report.ready
    ? 'ARCA responde: se puede emitir'
    : report.pointOfSale.kind === 'sin-configurar'
      ? 'Configurá el punto de venta con `arcli config establecer puntoVenta <numero>`.'
      : report.pointOfSale.kind === 'habilitado' || report.pointOfSale.kind === 'sin-datos'
        ? 'ARCA tiene problemas: esperá unos minutos y reintentá'
        : report.pointOfSale.kind === 'no-encontrado'
          ? `Revisá el punto de venta con \`arcli parametros puntos-venta\`. Los de "Factura en línea" no sirven; para crear uno para web service: ${POINT_OF_SALE_GUIDE_URL}`
          : 'Revisá el punto de venta con `arcli parametros puntos-venta`.';

  return sheetPanel(
    'Estado de ARCA',
    renderKeyValueRows(rows, { labelWidth: resolveKeyValueLabelWidth('standard', rows) }),
    { footer, tone: report.ready ? 'success' : 'warning' },
  );
}

function serializeServers(servers: ServerStatus) {
  return { aplicacion: servers.app, autenticacion: servers.auth, baseDeDatos: servers.db };
}

export function serializeStatus(report: StatusReport) {
  const point = 'point' in report.pointOfSale ? report.pointOfSale.point : undefined;
  const pointOfSale = {
    estado: report.pointOfSale.kind,
    numero: report.pointOfSaleNumber ?? null,
    tipoEmision: point?.emissionType ?? null,
  };

  return {
    deprecado: [DEPRECATED_POINT_OF_SALE_OBJECT],
    entorno: report.environment,
    latenciaMs: report.latencyMs,
    listo: report.ready,
    puntoVenta: pointOfSale,
    puntoVentaDetalle: pointOfSale,
    servidores: serializeServers(report.servers),
    servidoresExportacion: report.exportServers ? serializeServers(report.exportServers) : null,
  };
}
