import { z } from 'zod';

export const arcliEnvironmentSchema = z.enum(['testing', 'produccion']);
export const arcliDefaultConceptSchema = z.enum(['productos', 'productos-servicios', 'servicios']);
export const arcliDefaultIvaConditionSchema = z.enum([
  'cliente-del-exterior',
  'consumidor-final',
  'iva-liberado',
  'iva-no-alcanzado',
  'monotributista-social',
  'monotributo-trabajador-independiente-promovido',
  'proveedor-del-exterior',
  'responsable-inscripto',
  'responsable-monotributo',
  'sujeto-exento',
  'sujeto-no-categorizado',
]);
export const arcliDefaultCurrencySchema = z
  .string()
  .trim()
  .length(3)
  .transform((value) => value.toUpperCase());

export const arcliConfigSchema = z.object({
  cert: z
    .object({
      produccion: z.string().trim().min(1).optional(),
      testing: z.string().trim().min(1).optional(),
    })
    .default({}),
  cuit: z
    .string()
    .trim()
    .regex(/^\d{11}$/, 'El CUIT debe tener 11 digitos')
    .optional(),
  conceptoPorDefecto: arcliDefaultConceptSchema.optional(),
  ivaReceptorPorDefecto: arcliDefaultIvaConditionSchema.optional(),
  monedaPorDefecto: arcliDefaultCurrencySchema.optional(),
  cotizacionPorDefecto: z.number().positive().optional(),
  entornoPorDefecto: arcliEnvironmentSchema.default('testing'),
  key: z
    .object({
      produccion: z.string().trim().min(1).optional(),
      testing: z.string().trim().min(1).optional(),
    })
    .default({}),
  output: z
    .object({
      emitirPorDefecto: z.boolean().default(false),
      jsonPorDefecto: z.boolean().default(false),
      brutoPorDefecto: z.boolean().default(false),
    })
    .default({ emitirPorDefecto: false, jsonPorDefecto: false, brutoPorDefecto: false }),
  puntoVentaPorDefecto: z.number().int().positive().optional(),
  ticketPath: z.string().trim().min(1).optional(),
});

export type ArcliConfig = z.infer<typeof arcliConfigSchema>;
export type ArcliEnvironment = z.infer<typeof arcliEnvironmentSchema>;

export const CONFIG_DEFAULTS: ArcliConfig = {
  cert: {},
  entornoPorDefecto: 'testing',
  key: {},
  monedaPorDefecto: 'PES',
  cotizacionPorDefecto: 1,
  output: {
    emitirPorDefecto: false,
    jsonPorDefecto: false,
    brutoPorDefecto: false,
  },
};

export const configPublicKeySchema = z.enum([
  'cert.produccion',
  'cert.testing',
  'concepto',
  'cuit',
  'cotizacion',
  'entorno',
  'emitir',
  'ivaReceptor',
  'json',
  'key.produccion',
  'key.testing',
  'moneda',
  'bruto',
  'puntoVenta',
  'ticketPath',
]);

export type ConfigPublicKey = z.infer<typeof configPublicKeySchema>;
