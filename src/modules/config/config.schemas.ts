import { z } from 'zod';

import {
  billingConceptValueSchema,
  billingIvaConditionSchema,
  billingIvaRateSchema,
  cbuAliasSchema,
  cbuSchema,
} from '../billing/billing.schemas';
import { ARCA_LOCAL_CURRENCY_CODE } from '../billing/currency-codes';
import { saleConditionSchema } from '../billing/sale-condition';
import { MAX_RECENT_VOUCHERS, RECENT_VOUCHERS_LIMIT } from '../vouchers/voucher-history';

export const arcliEnvironmentSchema = z.enum(['testing', 'produccion']);
export const arcliDefaultConceptSchema = billingConceptValueSchema;
export const arcliDefaultIvaConditionSchema = billingIvaConditionSchema;
const arcliDefaultCurrencySchema = z
  .string()
  .trim()
  .length(3)
  .transform((value) => value.toUpperCase());

export const arcliPdfModeSchema = z.enum(['siempre', 'preguntar', 'nunca']);

/** Rutas de certificado o clave por entorno; no se leen al parsear la config. */
const certificatePathsSchema = z.object({
  produccion: z.string().trim().min(1).optional(),
  testing: z.string().trim().min(1).optional(),
});

const rowsPerListSchema = (key: string) =>
  z.number().int().min(1).max(MAX_RECENT_VOUCHERS, `\`${key}\` debe ser ${MAX_RECENT_VOUCHERS} o menos.`).optional();

// Misma normalizacion que --alicuota ("10,5", "10.5%").
export const arcliDefaultIvaRateSchema = billingIvaRateSchema;

export const arcliConfigSchema = z.object({
  alicuotaPorDefecto: arcliDefaultIvaRateSchema.optional(),
  cert: certificatePathsSchema.default({}),
  cuit: z
    .string()
    .trim()
    .regex(/^\d{11}$/, 'El CUIT debe tener 11 dígitos')
    .optional(),
  cbu: cbuSchema.optional(),
  aliasCbu: cbuAliasSchema.optional(),
  conceptoPorDefecto: arcliDefaultConceptSchema.optional(),
  ivaReceptorPorDefecto: arcliDefaultIvaConditionSchema.optional(),
  monedaPorDefecto: arcliDefaultCurrencySchema.optional(),
  cotizacionPorDefecto: z.number().positive().optional(),
  /** Datos del emisor que ARCA no guarda y solo se usan en el PDF. */
  emisor: z
    .object({
      condicionIva: arcliDefaultIvaConditionSchema.optional(),
      domicilio: z.string().trim().min(1).optional(),
      iibb: z.string().trim().min(1).optional(),
      /** yyyymmdd */
      inicioActividades: z
        .string()
        .regex(/^\d{8}$/, 'El inicio de actividades tiene que ser una fecha AAAAMMDD.')
        .optional(),
      logo: z.string().trim().min(1).optional(),
      razonSocial: z.string().trim().min(1).optional(),
    })
    .default({}),
  entornoPorDefecto: arcliEnvironmentSchema.default('testing'),
  /** WSFEX (factura de exportacion) usa su propio certificado, autorizado al servicio wsfex. */
  exportacion: z
    .object({
      /** Codigo de la tabla de actividades de WSFEX que va en `Actividades` de la factura E. */
      actividad: z.number().int().positive().optional(),
      cert: certificatePathsSchema.default({}),
      key: certificatePathsSchema.default({}),
    })
    .optional(),
  key: certificatePathsSchema.default({}),
  /** Monotributo: `tope` pisa el tope de ingresos anuales de la categoria (para `arcli monotributo` y el resumen). */
  monotributo: z
    .object({
      tope: z.number().positive().optional(),
    })
    .optional(),
  output: z
    .object({
      emitirPorDefecto: z.boolean().default(false),
      jsonPorDefecto: z.boolean().default(false),
      brutoPorDefecto: z.boolean().default(false),
    })
    .default({ emitirPorDefecto: false, jsonPorDefecto: false, brutoPorDefecto: false }),
  pdf: arcliPdfModeSchema.optional(),
  pdfCarpeta: z.string().trim().min(1).optional(),
  pdfNavegador: z.string().trim().min(1).optional(),
  /** Condicion de venta del PDF de A, B y C cuando el comprobante no trae una. */
  condicionVenta: saleConditionSchema.optional(),
  /** Filas de `arcli ultimos` y de las listas del modo interactivo (comprobantes, tablas de ARCA, monedas). */
  filasPorLista: rowsPerListSchema('filasPorLista'),
  /** Deprecada hasta la 3.0.0: se lee si no hay `filasPorLista`, y `config establecer` la pasa a `filasPorLista`. */
  comprobantesPorLista: rowsPerListSchema('comprobantesPorLista'),
  puntoVentaPorDefecto: z.number().int().positive().optional(),
  ticketPath: z.string().trim().min(1).optional(),
  /** Completar el IVA receptor desde el padron al facturar con --cuit. Sin definir, si. */
  consultarPadron: z.boolean().optional(),
  verificarFce: z.boolean().optional(),
});

export type ArcliConfig = z.infer<typeof arcliConfigSchema>;
export type ArcliEnvironment = z.infer<typeof arcliEnvironmentSchema>;

/** El padrón se consulta salvo que se haya apagado con `consultarPadron false`. */
export function isPadronLookupEnabled(config: Pick<ArcliConfig, 'consultarPadron'>): boolean {
  return config.consultarPadron ?? true;
}

/** Lo mismo en facturacion, la E y las consultas. */
export const MISSING_POINT_OF_SALE_MESSAGE =
  'Falta el punto de venta. Usá `--pv <numero>` o configuralo con `arcli config establecer puntoVenta <numero>`.';

/** El error de un entorno sin CUIT: `config revisar` lo reconoce para no mostrarlo dos veces. */
export const MISSING_CUIT_MESSAGE = 'Falta el CUIT. Configuralo con `arcli config establecer cuit <valor>`.';

/** El entorno como se lee en un texto; el valor (`produccion`) sigue igual en flags, claves y JSON. */
export function formatEnvironmentLabel(environment: ArcliEnvironment): string {
  return environment === 'produccion' ? 'producción' : environment;
}
export type ArcliPdfMode = z.infer<typeof arcliPdfModeSchema>;

/** `cotizacion` se saca en la 3.0.0: una cotizacion guardada queda vieja en dias (REV-35). */
export const COTIZACION_DEPRECATION_WARNING =
  'La clave "cotizacion" está deprecada y se va a sacar en la 3.0.0: una cotización guardada queda vieja. Sin ella se usa la cotización oficial de ARCA; para otra, pasá `--cm` al facturar.';

/**
 * Filas por pagina de las listas: `filasPorLista`, o la clave deprecada `comprobantesPorLista` si es la unica que
 * esta en el archivo.
 */
export function resolveConfiguredRowsPerList(
  config: Pick<ArcliConfig, 'comprobantesPorLista' | 'filasPorLista'>,
): number | undefined {
  return config.filasPorLista ?? config.comprobantesPorLista;
}

export function resolveRowsPerList(config: Pick<ArcliConfig, 'comprobantesPorLista' | 'filasPorLista'>): number {
  return resolveConfiguredRowsPerList(config) ?? RECENT_VOUCHERS_LIMIT;
}

/** `comprobantesPorLista` se renombro a `filasPorLista` porque tambien cuenta tablas y monedas (CONF-1). */
export const ROWS_PER_LIST_DEPRECATION_WARNING =
  'La clave "comprobantesPorLista" está deprecada y se va a sacar en la 3.0.0: usá `filasPorLista`.';

/** `cbu` y `aliasCbu` se guardan juntos con `cuenta`: el alias es de ese CBU. En el archivo y en `--json` siguen igual. */
export function accountKeyDeprecationWarning(key: 'aliasCbu' | 'cbu', use: string): string {
  return `La clave "${key}" está deprecada y se va a sacar en la 3.0.0: usá ${use}.`;
}

export const CONFIG_DEFAULTS: ArcliConfig = {
  cert: {},
  emisor: {},
  entornoPorDefecto: 'testing',
  key: {},
  monedaPorDefecto: ARCA_LOCAL_CURRENCY_CODE,
  cotizacionPorDefecto: 1,
  output: {
    emitirPorDefecto: false,
    jsonPorDefecto: false,
    brutoPorDefecto: false,
  },
};
