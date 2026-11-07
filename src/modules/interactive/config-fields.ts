import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { formatArgentineAmountInput } from '../../lib/numbers/argentine-amount';
import { maskPath } from '../../lib/paths/mask-path';
import { ivaConditionCode, ivaConditionLabel } from '../billing/arca-codes';
import { SALE_CONDITION_KEYS, SALE_CONDITION_LABELS } from '../billing/sale-condition';
import {
  type ArcliConfig,
  arcliDefaultConceptSchema,
  arcliDefaultIvaConditionSchema,
  arcliEnvironmentSchema,
  arcliPdfModeSchema,
  type ConfigPublicKey,
} from '../config/config.schemas';
import { CONFIG_LABELS } from '../config/config.sections';
import { MAX_RECENT_VOUCHERS, RECENT_VOUCHERS_LIMIT } from '../vouchers/voucher-history';

import { conceptChoices, ivaRateChoices } from './choices';

function labelsOf(choices: ReadonlyArray<{ readonly name: string; readonly value: string }>): Record<string, string> {
  return Object.fromEntries(choices.map((choice) => [choice.value, choice.name]));
}

const IVA_CONDITION_LABELS = Object.fromEntries(
  arcliDefaultIvaConditionSchema.options.map((key) => [key, ivaConditionLabel(ivaConditionCode(key))]),
);

const YES_NO_LABELS = { no: 'No', si: 'Sí' };

/** Un dato de la config que se puede cambiar desde el modo interactivo. */
export interface ConfigField {
  /** Valores posibles para elegir de una lista; sin esto se escribe. */
  readonly choices?: readonly string[];
  /** Etiquetas amigables para los valores de `choices`. */
  readonly choiceLabels?: Readonly<Record<string, string>>;
  readonly hint?: string;
  readonly key: ConfigPublicKey;
  /** El mismo nombre que en `arcli config` (ver CONFIG_LABELS). */
  readonly label: string;
  /** Las rutas se muestran enmascaradas, igual que en `arcli config`. */
  readonly path?: boolean;
  readonly read: (config: ArcliConfig) => string | undefined;
}

const date = (value: string | undefined) => (value ? formatArcaDateAsArgentineDate(value) : undefined);

/**
 * Datos editables desde el asistente. El orden y las secciones salen de CONFIG_SECTIONS; emitir, json y bruto
 * no estan porque solo cambian el CLI con flags, no el asistente.
 */
const FIELD_DEFINITIONS: ReadonlyArray<Omit<ConfigField, 'label'>> = [
  { key: 'cuit', read: (c) => c.cuit, hint: '11 dígitos' },
  {
    choices: arcliEnvironmentSchema.options,
    key: 'entorno',
    read: (c) => c.entornoPorDefecto,
  },
  {
    key: 'cert.testing',
    path: true,
    read: (c) => c.cert.testing,
  },
  {
    key: 'key.testing',
    path: true,
    read: (c) => c.key.testing,
  },
  {
    key: 'cert.produccion',
    path: true,
    read: (c) => c.cert.produccion,
  },
  {
    key: 'key.produccion',
    path: true,
    read: (c) => c.key.produccion,
  },
  { key: 'exportacion.cert.testing', path: true, read: (c) => c.exportacion?.cert.testing },
  { key: 'exportacion.key.testing', path: true, read: (c) => c.exportacion?.key.testing },
  { key: 'exportacion.cert.produccion', path: true, read: (c) => c.exportacion?.cert.produccion },
  { key: 'exportacion.key.produccion', path: true, read: (c) => c.exportacion?.key.produccion },
  {
    hint: 'código de la tabla de WSFEX, por ejemplo 620100',
    key: 'exportacion.actividad',
    read: (c) => c.exportacion?.actividad?.toString(),
  },
  {
    hint: 'número',
    key: 'puntoVenta',
    read: (c) => c.puntoVentaPorDefecto?.toString(),
  },
  {
    choiceLabels: labelsOf(conceptChoices()),
    choices: arcliDefaultConceptSchema.options,
    key: 'concepto',
    read: (c) => c.conceptoPorDefecto,
  },
  {
    choiceLabels: IVA_CONDITION_LABELS,
    choices: arcliDefaultIvaConditionSchema.options,
    key: 'ivaReceptor',
    read: (c) => c.ivaReceptorPorDefecto,
  },
  {
    choiceLabels: labelsOf(ivaRateChoices()),
    choices: ivaRateChoices().map((choice) => choice.value),
    key: 'alicuota',
    read: (c) => c.alicuotaPorDefecto,
  },
  {
    hint: `1 a ${MAX_RECENT_VOUCHERS}, por defecto ${RECENT_VOUCHERS_LIMIT}`,
    key: 'comprobantesPorLista',
    read: (c) => c.comprobantesPorLista?.toString(),
  },
  { hint: '22 dígitos', key: 'cbu', read: (c) => c.cbu },
  { key: 'aliasCbu', read: (c) => c.aliasCbu },
  {
    choiceLabels: YES_NO_LABELS,
    choices: ['si', 'no'],
    hint: 'por defecto si',
    key: 'consultarPadron',
    read: (c) => (c.consultarPadron === undefined ? undefined : c.consultarPadron ? 'si' : 'no'),
  },
  {
    choiceLabels: YES_NO_LABELS,
    choices: ['si', 'no'],
    key: 'verificarFce',
    read: (c) => (c.verificarFce === undefined ? undefined : c.verificarFce ? 'si' : 'no'),
  },
  {
    choices: arcliPdfModeSchema.options,
    key: 'pdf',
    read: (c) => c.pdf,
  },
  { key: 'pdfCarpeta', path: true, read: (c) => c.pdfCarpeta },
  { key: 'pdfNavegador', path: true, read: (c) => c.pdfNavegador },
  {
    choices: SALE_CONDITION_KEYS,
    choiceLabels: SALE_CONDITION_LABELS,
    key: 'condicionVenta',
    read: (c) => c.condicionVenta,
  },
  { key: 'emisor.razonSocial', read: (c) => c.emisor.razonSocial },
  { key: 'emisor.domicilio', read: (c) => c.emisor.domicilio },
  {
    hint: 'D/MM/YYYY',
    key: 'emisor.inicioActividades',
    read: (c) => date(c.emisor.inicioActividades),
  },
  { hint: 'número, o "Exento" si lo estás', key: 'emisor.iibb', read: (c) => c.emisor.iibb },
  {
    choiceLabels: IVA_CONDITION_LABELS,
    choices: arcliDefaultIvaConditionSchema.options,
    key: 'emisor.condicionIva',
    read: (c) => c.emisor.condicionIva,
  },
  { key: 'emisor.logo', path: true, read: (c) => c.emisor.logo },
  {
    hint: 'código de moneda, por ejemplo PES o USD',
    key: 'moneda',
    read: (c) => c.monedaPorDefecto,
  },
  {
    hint: 'solo para moneda extranjera',
    key: 'cotizacion',
    read: (c) =>
      c.cotizacionPorDefecto === undefined ? undefined : formatArgentineAmountInput(c.cotizacionPorDefecto),
  },
  { key: 'ticketPath', path: true, read: (c) => c.ticketPath },
];

export const CONFIG_FIELDS: readonly ConfigField[] = FIELD_DEFINITIONS.map((field) => ({
  ...field,
  label: CONFIG_LABELS[field.key],
}));

export function getConfigField(key: ConfigPublicKey): ConfigField {
  const field = CONFIG_FIELDS.find((candidate) => candidate.key === key);

  if (!field) {
    throw new Error(`Campo de config desconocido: ${key}`);
  }

  return field;
}

/** Valor para mostrar al lado del nombre. */
export function describeConfigValue(field: ConfigField, config: ArcliConfig): string {
  const value = field.read(config);

  if (!value) {
    return 'sin configurar';
  }

  return field.path ? maskPath(value) : (field.choiceLabels?.[value] ?? value);
}

/** Lo minimo para emitir: sin esto el modo interactivo no puede crear la sesion con ARCA. */
const REQUIRED_SETUP_KEYS: readonly ConfigPublicKey[] = ['cuit', 'cert.testing', 'key.testing', 'puntoVenta'];

export function listMissingSetupKeys(config: ArcliConfig): ConfigPublicKey[] {
  return REQUIRED_SETUP_KEYS.filter((key) => !getConfigField(key).read(config));
}
