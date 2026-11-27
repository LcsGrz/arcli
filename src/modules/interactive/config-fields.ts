import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { formatArgentineAmountInput } from '../../lib/numbers/argentine-amount';
import { ivaConditionCode, ivaConditionLabel } from '../billing/arca-codes';
import { SALE_CONDITION_KEYS, SALE_CONDITION_LABELS } from '../billing/sale-condition';
import { formatSavedAccount } from '../config/cbu-alias-change';
import {
  type ArcliConfig,
  arcliDefaultConceptSchema,
  arcliDefaultIvaConditionSchema,
  type ArcliEnvironment,
  arcliEnvironmentSchema,
  type ArcliPdfMode,
  arcliPdfModeSchema,
  formatEnvironmentLabel,
  resolveConfiguredRowsPerList,
} from '../config/config.schemas';
import { CONFIG_LABELS } from '../config/config.sections';
import type { ConfigPublicKey } from '../config/config-key-table';
import { MAX_RECENT_VOUCHERS, RECENT_VOUCHERS_LIMIT } from '../vouchers/voucher-history';

import { conceptChoices, ivaRateChoices } from './choices';

function labelsOf(choices: ReadonlyArray<{ readonly name: string; readonly value: string }>): Record<string, string> {
  return Object.fromEntries(choices.map((choice) => [choice.value, choice.name]));
}

const IVA_CONDITION_LABELS = Object.fromEntries(
  arcliDefaultIvaConditionSchema.options.map((key) => [key, ivaConditionLabel(ivaConditionCode(key))]),
);

const YES_NO_LABELS = { no: 'No', si: 'Sí' };

const PDF_MODE_LABELS: Readonly<Record<ArcliPdfMode, string>> = {
  nunca: 'Nunca',
  preguntar: 'Preguntar',
  siempre: 'Siempre',
};

/** Un dato de la config que se puede cambiar desde el modo interactivo. */
export interface ConfigField {
  /** Valores posibles para elegir de una lista; sin esto se escribe. */
  readonly choices?: readonly string[];
  /** Etiquetas amigables para los valores de `choices`. */
  readonly choiceLabels?: Readonly<Record<string, string>>;
  /** Ademas de `choices`, acepta un texto propio, como la condicion de venta: se elige de la lista o se escribe. */
  readonly freeText?: boolean;
  readonly hint?: string;
  readonly key: ConfigPublicKey;
  /** El mismo nombre que en `arcli config` (ver CONFIG_LABELS). */
  readonly label: string;
  /** Una ruta: se puede arrastrar el archivo o la carpeta a la terminal. */
  readonly path?: 'archivo' | 'carpeta';
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
    choiceLabels: Object.fromEntries(
      arcliEnvironmentSchema.options.map((environment) => [environment, formatEnvironmentLabel(environment)]),
    ),
    choices: arcliEnvironmentSchema.options,
    key: 'entorno',
    read: (c) => c.entornoPorDefecto,
  },
  {
    key: 'cert.testing',
    path: 'archivo',
    read: (c) => c.cert.testing,
  },
  {
    key: 'key.testing',
    path: 'archivo',
    read: (c) => c.key.testing,
  },
  {
    key: 'cert.produccion',
    path: 'archivo',
    read: (c) => c.cert.produccion,
  },
  {
    key: 'key.produccion',
    path: 'archivo',
    read: (c) => c.key.produccion,
  },
  { key: 'exportacion.cert.testing', path: 'archivo', read: (c) => c.exportacion?.cert.testing },
  { key: 'exportacion.key.testing', path: 'archivo', read: (c) => c.exportacion?.key.testing },
  { key: 'exportacion.cert.produccion', path: 'archivo', read: (c) => c.exportacion?.cert.produccion },
  { key: 'exportacion.key.produccion', path: 'archivo', read: (c) => c.exportacion?.key.produccion },
  {
    hint: 'código de la tabla de WSFEX, por ejemplo 620100',
    key: 'exportacion.actividad',
    read: (c) => c.exportacion?.actividad?.toString(),
  },
  {
    hint: 'número; en testing sirve cualquiera, en producción tiene que ser uno de web service, no el de Factura en línea',
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
    key: 'filasPorLista',
    read: (c) => resolveConfiguredRowsPerList(c)?.toString(),
  },
  // El asistente la pregunta en dos pasos (`askAccount`).
  { hint: 'CBU de 22 dígitos y alias opcional', key: 'cuenta', read: formatSavedAccount },
  {
    choiceLabels: YES_NO_LABELS,
    choices: ['si', 'no'],
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
    choiceLabels: YES_NO_LABELS,
    choices: ['si', 'no'],
    key: 'asistente.comandoEquivalente',
    read: (c) => {
      const shown = c.asistente?.comandoEquivalente;

      return shown === undefined ? undefined : shown ? 'si' : 'no';
    },
  },
  {
    choiceLabels: PDF_MODE_LABELS,
    choices: arcliPdfModeSchema.options,
    key: 'pdf',
    read: (c) => c.pdf,
  },
  { key: 'pdfCarpeta', path: 'carpeta', read: (c) => c.pdfCarpeta },
  { key: 'pdfNavegador', path: 'archivo', read: (c) => c.pdfNavegador },
  {
    choices: SALE_CONDITION_KEYS,
    choiceLabels: SALE_CONDITION_LABELS,
    freeText: true,
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
  { key: 'emisor.logo', path: 'archivo', read: (c) => c.emisor.logo },
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
  { key: 'ticketPath', path: 'carpeta', read: (c) => c.ticketPath },
  {
    hint: 'ingresos anuales en pesos, por ejemplo 30.000.000; por defecto, el de tu categoría',
    key: 'monotributo.tope',
    read: (c) => (c.monotributo?.tope === undefined ? undefined : formatArgentineAmountInput(c.monotributo.tope)),
  },
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

/** El entorno en que va a emitir el asistente: el de `--produccion` o `--testing` de `arcli interactivo`, o el de la config. */
export function resolveActiveEnvironment(
  config: Pick<ArcliConfig, 'entornoPorDefecto'>,
  flags: { readonly produccion?: boolean; readonly testing?: boolean } = {},
): ArcliEnvironment {
  if (flags.produccion && !flags.testing) return 'produccion';
  if (flags.testing && !flags.produccion) return 'testing';

  return config.entornoPorDefecto;
}

/**
 * Lo minimo para emitir: sin esto el modo interactivo no puede crear la sesion con ARCA. El certificado es el del
 * entorno activo: quien emite solo en produccion no necesita el de testing.
 */
export function listMissingSetupKeys(
  config: ArcliConfig,
  environment: ArcliEnvironment = config.entornoPorDefecto,
): ConfigPublicKey[] {
  const required: readonly ConfigPublicKey[] = ['cuit', `cert.${environment}`, `key.${environment}`, 'puntoVenta'];

  return required.filter((key) => !getConfigField(key).read(config));
}
