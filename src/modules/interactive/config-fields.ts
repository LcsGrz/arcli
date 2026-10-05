import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { maskPath } from '../../lib/paths/mask-path';
import {
  type ArcliConfig,
  arcliDefaultConceptSchema,
  arcliDefaultIvaConditionSchema,
  arcliEnvironmentSchema,
  arcliPdfModeSchema,
  type ConfigPublicKey,
} from '../config/config.schemas';

export type ConfigFieldGroup = 'credenciales' | 'defaults' | 'emisor' | 'pdf';

/** Un dato de la config que se puede cambiar desde el modo interactivo. */
export interface ConfigField {
  /** Valores posibles para elegir de una lista; sin esto se escribe. */
  readonly choices?: readonly string[];
  readonly group: ConfigFieldGroup;
  readonly hint?: string;
  readonly key: ConfigPublicKey;
  readonly label: string;
  /** Las rutas se muestran enmascaradas, igual que en `arcli config`. */
  readonly path?: boolean;
  readonly read: (config: ArcliConfig) => string | undefined;
}

const date = (value: string | undefined) => (value ? formatArcaDateAsArgentineDate(value) : undefined);

export const CONFIG_GROUP_LABELS: Record<ConfigFieldGroup, string> = {
  credenciales: 'Credenciales',
  defaults: 'Valores por defecto',
  emisor: 'Datos del emisor (PDF)',
  pdf: 'PDF',
};

export const CONFIG_FIELDS: readonly ConfigField[] = [
  { group: 'credenciales', key: 'cuit', label: 'CUIT del emisor', read: (c) => c.cuit, hint: '11 digitos' },
  {
    choices: arcliEnvironmentSchema.options,
    group: 'credenciales',
    key: 'entorno',
    label: 'Entorno',
    read: (c) => c.entornoPorDefecto,
  },
  {
    group: 'credenciales',
    key: 'cert.testing',
    label: 'Certificado de testing',
    path: true,
    read: (c) => c.cert.testing,
  },
  {
    group: 'credenciales',
    key: 'key.testing',
    label: 'Clave privada de testing',
    path: true,
    read: (c) => c.key.testing,
  },
  {
    group: 'credenciales',
    key: 'cert.produccion',
    label: 'Certificado de produccion',
    path: true,
    read: (c) => c.cert.produccion,
  },
  {
    group: 'credenciales',
    key: 'key.produccion',
    label: 'Clave privada de produccion',
    path: true,
    read: (c) => c.key.produccion,
  },
  {
    group: 'defaults',
    hint: 'numero',
    key: 'puntoVenta',
    label: 'Punto de venta',
    read: (c) => c.puntoVentaPorDefecto?.toString(),
  },
  {
    choices: arcliDefaultConceptSchema.options,
    group: 'defaults',
    key: 'concepto',
    label: 'Concepto',
    read: (c) => c.conceptoPorDefecto,
  },
  {
    choices: arcliDefaultIvaConditionSchema.options,
    group: 'defaults',
    key: 'ivaReceptor',
    label: 'IVA del receptor',
    read: (c) => c.ivaReceptorPorDefecto,
  },
  {
    choices: ['general', 'reducida', 'incrementada', 'cero', '5', '2.5'],
    group: 'defaults',
    key: 'alicuota',
    label: 'Alicuota de IVA (A y B)',
    read: (c) => c.alicuotaPorDefecto,
  },
  { group: 'defaults', hint: '22 digitos', key: 'cbu', label: 'CBU (FCE)', read: (c) => c.cbu },
  { group: 'defaults', key: 'aliasCbu', label: 'Alias del CBU (FCE)', read: (c) => c.aliasCbu },
  {
    choices: ['si', 'no'],
    group: 'defaults',
    key: 'verificarFce',
    label: 'Verificar regimen FCE del receptor',
    read: (c) => (c.verificarFce === undefined ? undefined : c.verificarFce ? 'si' : 'no'),
  },
  {
    choices: arcliPdfModeSchema.options,
    group: 'pdf',
    key: 'pdf',
    label: 'Cuando generar el PDF',
    read: (c) => c.pdf,
  },
  { group: 'pdf', key: 'pdfCarpeta', label: 'Carpeta de PDFs', path: true, read: (c) => c.pdfCarpeta },
  { group: 'pdf', key: 'pdfNavegador', label: 'Navegador para PDFs', path: true, read: (c) => c.pdfNavegador },
  { group: 'emisor', key: 'emisor.razonSocial', label: 'Razon social', read: (c) => c.emisor.razonSocial },
  { group: 'emisor', key: 'emisor.domicilio', label: 'Domicilio comercial', read: (c) => c.emisor.domicilio },
  {
    group: 'emisor',
    hint: 'D/MM/YYYY',
    key: 'emisor.inicioActividades',
    label: 'Inicio de actividades',
    read: (c) => date(c.emisor.inicioActividades),
  },
  { group: 'emisor', key: 'emisor.iibb', label: 'Ingresos Brutos', read: (c) => c.emisor.iibb },
  {
    choices: arcliDefaultIvaConditionSchema.options,
    group: 'emisor',
    key: 'emisor.condicionIva',
    label: 'Condicion de IVA',
    read: (c) => c.emisor.condicionIva,
  },
  { group: 'emisor', key: 'emisor.logo', label: 'Logo (PNG o JPG)', path: true, read: (c) => c.emisor.logo },
];

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

  return field.path ? maskPath(value) : value;
}

/** Lo minimo para emitir: sin esto el modo interactivo no puede crear la sesion con ARCA. */
export const REQUIRED_SETUP_KEYS: readonly ConfigPublicKey[] = ['cuit', 'cert.testing', 'key.testing', 'puntoVenta'];

export function listMissingSetupKeys(config: ArcliConfig): ConfigPublicKey[] {
  return REQUIRED_SETUP_KEYS.filter((key) => !getConfigField(key).read(config));
}
