import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { formatCuit } from '../../lib/identity/format-cuit';
import { deleteAtPath } from '../../lib/json/object-path';
import { formatArgentineMoney, formatExchangeRate } from '../../lib/numbers/argentine-amount';
import { maskPath } from '../../lib/paths/mask-path';
import { attentionPanel, checklistPanel, sheetPanel } from '../../ui/components';
import {
  bold,
  colorize,
  pathLink,
  renderKeyValueRows,
  resolveKeyValueLabelWidth,
  toneText,
  uiSymbol,
} from '../../ui/primitives';
import { conceptCode, conceptLabel, ivaConditionCode, ivaConditionLabel } from '../billing/arca-codes';
import { DEFAULT_IVA_RATE } from '../billing/billing.amounts';
import { ARCA_LOCAL_CURRENCY_CODE } from '../billing/currency-codes';
import { SALE_CONDITION_LABELS, type SaleConditionKey } from '../billing/sale-condition';
import { RECENT_VOUCHERS_LIMIT } from '../vouchers/voucher-history';

import { formatSavedAccount } from './cbu-alias-change';
import type { ArcliConfig } from './config.schemas';
import { formatEnvironmentLabel, isPadronLookupEnabled, resolveConfiguredRowsPerList } from './config.schemas';
import { CONFIG_LABELS, CONFIG_SECTIONS } from './config.sections';
import { CONFIG_DOCTOR_SECTIONS, type ConfigDoctorReport } from './config-doctor';
import type { ConfigPublicKey } from './config-key-table';
import { DEPRECATED_CONFIG_KEYS } from './config-keys';
import type { PendingConfigProblems } from './config-problems';

interface PublicConfigSnapshot {
  readonly alicuota?: ArcliConfig['alicuotaPorDefecto'];
  readonly aliasCbu?: string;
  /** Deprecada hasta la 3.0.0: el mismo valor que `filasPorLista`, para quien ya la leia. */
  readonly comprobantesPorLista?: number;
  readonly cbu?: string;
  readonly cert: {
    readonly produccion?: string;
    readonly testing?: string;
  };
  readonly concepto?: ArcliConfig['conceptoPorDefecto'];
  readonly condicionVenta?: string;
  readonly cotizacion?: number;
  readonly cuit?: string;
  /** Solo si la respuesta trae una clave deprecada (`comprobantesPorLista`). */
  readonly deprecado?: readonly string[];
  readonly emisor: ArcliConfig['emisor'];
  readonly emitir: boolean;
  readonly entorno: 'produccion' | 'testing';
  readonly exportacion: {
    readonly actividad?: number;
    readonly cert: {
      readonly produccion?: string;
      readonly testing?: string;
    };
    readonly key: {
      readonly produccion?: string;
      readonly testing?: string;
    };
  };
  readonly filasPorLista?: number;
  readonly ivaReceptor?: ArcliConfig['ivaReceptorPorDefecto'];
  readonly json: boolean;
  readonly key: {
    readonly produccion?: string;
    readonly testing?: string;
  };
  readonly moneda?: string;
  /** Solo si hay `monotributo.tope`. */
  readonly monotributo?: {
    readonly tope: number;
  };
  readonly pdf: NonNullable<ArcliConfig['pdf']>;
  readonly pdfCarpeta: string;
  readonly pdfNavegador?: string;
  readonly puntoVenta?: number;
  readonly bruto: boolean;
  readonly ticketPath: string;
  readonly verificarFce?: boolean;
  readonly consultarPadron: boolean;
}

export interface ConfigPathSnapshot {
  /** Donde `arcli certificado` guarda claves y certificados; solo se muestra en el texto. */
  readonly certificatesFolder?: string;
  readonly pdfFolder: string;
  readonly ticketPath: string;
}

function toPublicSnapshot(config: ArcliConfig, paths: ConfigPathSnapshot): PublicConfigSnapshot {
  const dedicated = config.exportacion;
  const rowsPerList = resolveConfiguredRowsPerList(config);

  return {
    alicuota: config.alicuotaPorDefecto,
    aliasCbu: config.aliasCbu,
    comprobantesPorLista: rowsPerList,
    cbu: config.cbu,
    cert: {
      produccion: config.cert.produccion ? maskPath(config.cert.produccion) : undefined,
      testing: config.cert.testing ? maskPath(config.cert.testing) : undefined,
    },
    concepto: config.conceptoPorDefecto,
    condicionVenta: config.condicionVenta,
    cotizacion: config.cotizacionPorDefecto,
    cuit: config.cuit,
    emisor: { ...config.emisor, logo: config.emisor.logo ? maskPath(config.emisor.logo) : undefined },
    emitir: config.output.emitirPorDefecto,
    entorno: config.entornoPorDefecto,
    exportacion: {
      actividad: dedicated?.actividad,
      cert: {
        produccion: dedicated?.cert.produccion ? maskPath(dedicated.cert.produccion) : undefined,
        testing: dedicated?.cert.testing ? maskPath(dedicated.cert.testing) : undefined,
      },
      key: {
        produccion: dedicated?.key.produccion ? maskPath(dedicated.key.produccion) : undefined,
        testing: dedicated?.key.testing ? maskPath(dedicated.key.testing) : undefined,
      },
    },
    filasPorLista: rowsPerList,
    ivaReceptor: config.ivaReceptorPorDefecto,
    json: config.output.jsonPorDefecto,
    key: {
      produccion: config.key.produccion ? maskPath(config.key.produccion) : undefined,
      testing: config.key.testing ? maskPath(config.key.testing) : undefined,
    },
    moneda: config.monedaPorDefecto,
    monotributo: config.monotributo?.tope === undefined ? undefined : { tope: config.monotributo.tope },
    pdf: config.pdf ?? 'preguntar',
    pdfCarpeta: maskPath(paths.pdfFolder),
    pdfNavegador: config.pdfNavegador ? maskPath(config.pdfNavegador) : undefined,
    puntoVenta: config.puntoVentaPorDefecto,
    bruto: config.output.brutoPorDefecto,
    ticketPath: maskPath(paths.ticketPath),
    verificarFce: config.verificarFce,
    consultarPadron: isPadronLookupEnabled(config),
    deprecado: rowsPerList === undefined ? undefined : [ROWS_PER_LIST_JSON_DEPRECATION],
  };
}

export function serializeConfig(
  config: ArcliConfig,
  paths: ConfigPathSnapshot,
  pending?: PendingConfigProblems,
  warnings: readonly string[] = [],
) {
  const snapshot = toPublicSnapshot(config, paths);

  if (!pending) {
    return warnings.length > 0 ? { ...snapshot, avisos: warnings } : snapshot;
  }

  const visible = structuredClone(snapshot) as unknown as Record<string, unknown>;

  for (const key of pending.keys) {
    deleteAtPath(visible, key);
  }

  // El aviso nombra las dos: sin una en la respuesta, no tiene a que mandar.
  if (pending.keys.some((key) => key === 'comprobantesPorLista' || key === 'filasPorLista')) {
    delete visible.deprecado;
  }

  return { ...visible, avisos: [...warnings, ...pending.warnings] };
}

/** Lo que hizo de mas y lo que sigue mal despues de `config establecer` o `config eliminar`, para stderr. */
export function formatConfigChangeWarnings(
  pending: PendingConfigProblems | undefined,
  warnings: readonly string[] = [],
): string | undefined {
  const all = [...warnings, ...(pending?.warnings ?? [])];

  return all.length > 0
    ? attentionPanel('Avisos', all.map((warning) => `${uiSymbol('bullet')} ${warning}`).join('\n'))
    : undefined;
}

/** Una parte de lo que guarda `key`: `cbu` y `aliasCbu`, de `cuenta`. */
function isPartOf(name: string, key: ConfigPublicKey): boolean {
  const deprecated = Object.hasOwn(DEPRECATED_CONFIG_KEYS, name) ? DEPRECATED_CONFIG_KEYS[name] : undefined;

  return deprecated?.storedAs !== undefined && deprecated.replacement === key;
}

function isPending(key: ConfigPublicKey, config: ArcliConfig, pending: PendingConfigProblems | undefined): boolean {
  return (
    pending?.keys.some(
      (name) =>
        key === name ||
        key.startsWith(`${name}.`) ||
        isPartOf(name, key) ||
        (name === 'comprobantesPorLista' && key === 'filasPorLista' && config.filasPorLista === undefined),
    ) ?? false
  );
}

/** `{ "ruta": "..." }`, como `ruta` en el JSON de `pdf desinstalar`. */
export function serializeConfigPath(configPath: string) {
  return { ruta: configPath };
}

const ROWS_PER_LIST_JSON_DEPRECATION =
  '`comprobantesPorLista` se saca en la 3.0.0: usá `filasPorLista`, que trae el mismo valor.';

const NOT_SET = 'sin configurar';
const INVALID = 'dato inválido';
const BY_DEFAULT = '(por defecto)';

/** Lo guardado, como se muestra; `undefined` si no hay nada guardado. */
type SavedConfigText = (config: PublicConfigSnapshot, raw: ArcliConfig) => number | string | undefined;

const yesNo = (value: boolean): string => (value ? 'sí' : 'no');
const optionalYesNo = (value: boolean | undefined): string | undefined =>
  value === undefined ? undefined : yesNo(value);
const formatIvaRate = (rate: string): string => `${rate.replace('.', ',')}%`;
const ivaCondition = (value: ArcliConfig['ivaReceptorPorDefecto']): string | undefined =>
  value && ivaConditionLabel(ivaConditionCode(value));
const saleCondition = (value: string | undefined): string | undefined =>
  value && (Object.hasOwn(SALE_CONDITION_LABELS, value) ? SALE_CONDITION_LABELS[value as SaleConditionKey] : value);

/** Como se muestra cada dato guardado, en `arcli config` y en "Modificar configuración" del asistente. */
const SAVED_TEXTS: Record<ConfigPublicKey, SavedConfigText> = {
  alicuota: (c) => c.alicuota && formatIvaRate(c.alicuota),
  bruto: (c) => yesNo(c.bruto),
  'cert.produccion': (c) => c.cert.produccion,
  'cert.testing': (c) => c.cert.testing,
  concepto: (c) => c.concepto && conceptLabel(conceptCode(c.concepto)),
  condicionVenta: (c) => saleCondition(c.condicionVenta),
  cotizacion: (c) => (c.cotizacion === undefined ? undefined : formatExchangeRate(c.cotizacion)),
  cuenta: (c) => formatSavedAccount(c),
  cuit: (c) => c.cuit && formatCuit(c.cuit),
  'emisor.condicionIva': (c) => ivaCondition(c.emisor.condicionIva),
  'emisor.domicilio': (c) => c.emisor.domicilio,
  'emisor.iibb': (c) => c.emisor.iibb,
  'emisor.inicioActividades': (c) =>
    c.emisor.inicioActividades && formatArcaDateAsArgentineDate(c.emisor.inicioActividades),
  'emisor.logo': (c) => c.emisor.logo,
  'emisor.razonSocial': (c) => c.emisor.razonSocial,
  emitir: (c) => yesNo(c.emitir),
  entorno: (c) => formatEnvironmentLabel(c.entorno),
  'exportacion.actividad': (c) => c.exportacion.actividad,
  'exportacion.cert.produccion': (c) => c.exportacion.cert.produccion,
  'exportacion.cert.testing': (c) => c.exportacion.cert.testing,
  'exportacion.key.produccion': (c) => c.exportacion.key.produccion,
  'exportacion.key.testing': (c) => c.exportacion.key.testing,
  filasPorLista: (c) => c.filasPorLista,
  ivaReceptor: (c) => ivaCondition(c.ivaReceptor),
  json: (c) => yesNo(c.json),
  'key.produccion': (c) => c.key.produccion,
  'key.testing': (c) => c.key.testing,
  moneda: (c) => c.moneda,
  'monotributo.tope': (c) => c.monotributo && formatArgentineMoney(c.monotributo.tope),
  // El snapshot trae el valor por defecto en su lugar: si está guardado lo dice la config.
  pdf: (_c, raw) => raw.pdf,
  pdfCarpeta: (c, raw) => (raw.pdfCarpeta ? c.pdfCarpeta : undefined),
  pdfNavegador: (c) => c.pdfNavegador,
  puntoVenta: (c) => c.puntoVenta,
  ticketPath: (c, raw) => (raw.ticketPath ? c.ticketPath : undefined),
  verificarFce: (c) => optionalYesNo(c.verificarFce),
  consultarPadron: (_c, raw) => optionalYesNo(raw.consultarPadron),
};

interface ConfigDefault {
  /** Con "(por defecto)" al lado. Sin marca, el texto ya dice que no hay uno fijo: "automático", "según la letra". */
  readonly marked: boolean;
  /** Las carpetas son las de `paths`, que sin una guardada son las por defecto. */
  readonly text: (paths: ConfigPathSnapshot) => string;
}

const marked = (text: (paths: ConfigPathSnapshot) => string): ConfigDefault => ({ marked: true, text });
const unmarked = (text: string): ConfigDefault => ({ marked: false, text: () => text });

/** Lo que vale un dato sin nada guardado. Un dato que no está acá queda "sin configurar". */
const CONFIG_DEFAULTS: Partial<Record<ConfigPublicKey, ConfigDefault>> = {
  alicuota: marked(() => formatIvaRate(DEFAULT_IVA_RATE)),
  consultarPadron: marked(() => yesNo(isPadronLookupEnabled({}))),
  cotizacion: marked(() => formatExchangeRate(1)),
  'emisor.condicionIva': unmarked('según la letra'),
  entorno: marked(() => formatEnvironmentLabel('testing')),
  filasPorLista: marked(() => String(RECENT_VOUCHERS_LIMIT)),
  moneda: marked(() => ARCA_LOCAL_CURRENCY_CODE),
  'monotributo.tope': unmarked('el de tu categoría'),
  pdf: marked(() => 'preguntar'),
  pdfCarpeta: marked((paths) => maskPath(paths.pdfFolder)),
  pdfNavegador: unmarked('automático'),
  ticketPath: marked((paths) => maskPath(paths.ticketPath)),
  verificarFce: marked(() => yesNo(false)),
};

interface ConfigValueText {
  readonly byDefault: boolean;
  /** El dato sin "(por defecto)", que va aparte: en `arcli config` las rutas son links. */
  readonly text: string;
}

function configValueText(
  key: ConfigPublicKey,
  snapshot: PublicConfigSnapshot,
  config: ArcliConfig,
  paths: ConfigPathSnapshot,
): ConfigValueText {
  const saved = SAVED_TEXTS[key](snapshot, config);

  if (saved !== undefined && saved !== '') {
    return { byDefault: false, text: String(saved) };
  }

  const fallback = CONFIG_DEFAULTS[key];

  return fallback ? { byDefault: fallback.marked, text: fallback.text(paths) } : { byDefault: false, text: NOT_SET };
}

const withDefaultMark = (text: string, byDefault: boolean): string => (byDefault ? `${text} ${BY_DEFAULT}` : text);

/**
 * Como se muestra un dato: lo guardado o, sin nada guardado, el valor por defecto con "(por defecto)" o "sin
 * configurar". Es el mismo texto en `arcli config` y en "Modificar configuración" del asistente.
 */
export function formatConfigValue(key: ConfigPublicKey, config: ArcliConfig, paths: ConfigPathSnapshot): string {
  const { byDefault, text } = configValueText(key, toPublicSnapshot(config, paths), config, paths);

  return withDefaultMark(text, byDefault);
}

/**
 * El valor por defecto de un dato como se muestra ("21%", "automático"), o `undefined` si no tiene uno y sin nada
 * guardado queda sin configurar. Las carpetas salen de `paths`: con una guardada, `paths` trae esa.
 */
export function configDefaultText(key: ConfigPublicKey, paths: ConfigPathSnapshot): string | undefined {
  return CONFIG_DEFAULTS[key]?.text(paths);
}

/** La ruta completa de cada clave que es una ruta, para el link de `arcli config`. */
const CONFIG_PATHS: Partial<
  Record<ConfigPublicKey, (config: ArcliConfig, paths: ConfigPathSnapshot) => string | undefined>
> = {
  'cert.produccion': (c) => c.cert.produccion,
  'cert.testing': (c) => c.cert.testing,
  'emisor.logo': (c) => c.emisor.logo,
  'exportacion.cert.produccion': (c) => c.exportacion?.cert.produccion,
  'exportacion.cert.testing': (c) => c.exportacion?.cert.testing,
  'exportacion.key.produccion': (c) => c.exportacion?.key.produccion,
  'exportacion.key.testing': (c) => c.exportacion?.key.testing,
  'key.produccion': (c) => c.key.produccion,
  'key.testing': (c) => c.key.testing,
  pdfCarpeta: (_c, paths) => paths.pdfFolder,
  pdfNavegador: (c) => c.pdfNavegador,
  ticketPath: (_c, paths) => paths.ticketPath,
};

/**
 * La configuracion por secciones, en el mismo orden que "Modificar configuracion" del modo interactivo.
 * El peso esta en los valores: titulos en celeste, etiquetas y datos sin cargar atenuados.
 */
export function formatConfigAsText(
  config: ArcliConfig,
  paths: ConfigPathSnapshot,
  pending?: PendingConfigProblems,
): string {
  const safeConfig = toPublicSnapshot(config, paths);
  const sections = CONFIG_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    rows: section.keys.map((key) => {
      // Lo que se leyo no es lo guardado: con un default en su lugar, un `entorno` roto se leeria como testing.
      if (isPending(key, config, pending)) {
        return [CONFIG_LABELS[key], colorize(INVALID, 'warning')] as const;
      }

      const { byDefault, text } = configValueText(key, safeConfig, config, paths);
      const path = CONFIG_PATHS[key]?.(config, paths);

      // Las rutas se abren con un clic; el texto es el mismo que sin link.
      return [CONFIG_LABELS[key], withDefaultMark(path ? pathLink(path, text) : text, byDefault)] as const;
    }),
  }));
  // La carpeta de `arcli certificado` no es una clave de config: va al final de Certificados, como la de tickets.
  if (paths.certificatesFolder) {
    sections
      .find((section) => section.id === 'certificados')
      ?.rows.push(['Carpeta de certificados', pathLink(paths.certificatesFolder)] as const);
  }

  // Un solo ancho de etiqueta para todas las secciones, asi los valores quedan en la misma columna.
  const labelWidth = resolveKeyValueLabelWidth(
    'standard',
    sections.flatMap((section) => section.rows),
  );
  const lines = sections.flatMap((section, index) => [
    ...(index > 0 ? [''] : []),
    colorize(section.label, 'info'),
    // Los datos van corridos bajo el titulo, asi la seccion se lee aun sin color (NO_COLOR, pipes).
    ...renderKeyValueRows(
      section.rows.map(([label, value]) => [label, value === NOT_SET ? colorize(value, 'muted') : value] as const),
      { indent: 2, labelTone: 'muted', labelWidth },
    ),
  ]);

  return sheetPanel('Configuración', lines);
}

export function serializeConfigDoctor(report: ConfigDoctorReport) {
  return {
    chequeos: report.checks.map((check) => ({
      categoria: check.category,
      detalle: check.detail,
      etiqueta: check.label,
    })),
    ok: report.ok,
  };
}

function doctorIcon(category: ConfigDoctorReport['checks'][number]['category']): string {
  return { error: 'x', ok: uiSymbol('check'), warning: '!' }[category];
}

const DOCTOR_TONES = { error: 'danger', ok: 'success', warning: 'warning' } as const;

/** Sin el punto final, con el dato del chequeo (el ultimo que aparece) en negrita. */
function formatDoctorDetail(check: ConfigDoctorReport['checks'][number]): string {
  const detail = check.detail.replace(/\.$/, '');
  const index = check.value ? detail.lastIndexOf(check.value) : -1;

  if (!check.value || index < 0) {
    return detail;
  }

  return `${detail.slice(0, index)}${bold(check.value)}${detail.slice(index + check.value.length)}`;
}

/** Un chequeo que repite a otro no suma una fila: el repetido toma su categoria y su detalle. */
function mergeRepeatedChecks(checks: ConfigDoctorReport['checks']): ConfigDoctorReport['checks'] {
  return checks
    .filter((check) => !check.repeats)
    .map((check) => {
      const repeat = checks.find((other) => other.repeats === check.label);

      return repeat ? { ...check, category: repeat.category, detail: repeat.detail } : check;
    });
}

/** Por seccion, en el orden de `CONFIG_DOCTOR_SECTIONS`: un titulo y un item por chequeo. Lo que falla, en color. */
export function formatConfigDoctorAsText(report: ConfigDoctorReport): string {
  const visibleChecks = mergeRepeatedChecks(report.checks);
  const sections = CONFIG_DOCTOR_SECTIONS.map(([section, title]) => ({
    checks: visibleChecks.filter((check) => check.section === section),
    title,
  })).filter(({ checks }) => checks.length > 0);
  const lines = sections.flatMap(({ checks, title }, index) => [
    ...(index > 0 ? [''] : []),
    colorize(title, 'info'),
    ...checks.map((check) => {
      const tone = DOCTOR_TONES[check.category];
      const detail = formatDoctorDetail(check);

      // Dos espacios despues del icono: una linea larga sigue alineada al texto, no al icono.
      return `  ${toneText(doctorIcon(check.category), tone)}  ${check.category === 'ok' ? detail : colorize(detail, tone)}`;
    }),
  ]);
  const tone = report.ok ? 'success' : report.checks.some((check) => check.category === 'error') ? 'danger' : 'warning';
  const footer = report.ok
    ? 'Configuración lista para usar ARCLI'
    : report.checks.some((check) => check.category === 'error')
      ? 'Hay puntos críticos por corregir antes de emitir'
      : 'Revisá las recomendaciones antes de emitir en serio';

  return checklistPanel('Revisión de configuración', lines, { footer, tone });
}
