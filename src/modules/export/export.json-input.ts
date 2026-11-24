import { z } from 'zod';

import { InputValidationError } from '../../lib/errors/app-error';
import { describeJsonIssue, describeReceived, type JsonInputKeys } from '../../lib/json/json-input-issues';

import type { ExportItemInput } from './export.types';

/** El problema de una clave que admite mas de un tipo o valor; `describeJsonIssue` pone la clave y el punto. */
function expecting(expected: string, hint: (input: unknown) => string = () => '') {
  return ({ input }: { readonly input?: unknown }): string =>
    `tiene que ser ${expected} y llegó ${describeReceived(input)}${hint(input)}`;
}

const EXPORT_TYPE_CODES: readonly unknown[] = ['1', '2', '4'];

const itemJsonSchema = z
  .object({
    cantidad: z.number(),
    codigo: z.string().optional(),
    descripcion: z.string(),
    precioUnitario: z.number(),
    unidad: z.union([z.string(), z.number()], { error: expecting('un texto ("unidades") o un número (7)') }).optional(),
  })
  .strict();

/** El comprobante que ajusta una nota E, con las mismas claves que en A, B y C. */
const associatedVoucherJsonSchema = z
  .object({
    atajo: z.string().optional(),
    cuit: z.string().optional(),
    fecha: z.string().optional(),
    numero: z.number().optional(),
    puntoVenta: z.number().optional(),
    tipo: z.number().optional(),
  })
  .strict();

/**
 * Forma del JSON de `--cargar`: solo tipos y claves. Los valores (importes, pais, incoterm) los valida el
 * servicio igual que si vinieran por flags. Es `.strict()` para que un typo no se ignore en silencio.
 */
const exportJsonInputSchema = z
  .object({
    actividad: z.number().optional(),
    cliente: z.string().optional(),
    codigoMoneda: z.string().optional(),
    comprobanteAsociado: associatedVoucherJsonSchema.optional(),
    cotizacionMoneda: z.number().optional(),
    cuitPais: z.number().optional(),
    descripcion: z.string().optional(),
    descripcionIncoterm: z.string().optional(),
    domicilioCliente: z.string().optional(),
    emitir: z.boolean().optional(),
    fechaComprobante: z.string().optional(),
    fechaPago: z.string().optional(),
    formaPago: z.string().optional(),
    idImpositivo: z.string().optional(),
    idSolicitud: z.number().optional(),
    idioma: z.number().optional(),
    incoterm: z.string().optional(),
    items: z.array(itemJsonSchema).optional(),
    mismaMoneda: z.boolean().optional(),
    monto: z.number().optional(),
    montoTotal: z.number().optional(),
    numero: z.number().optional(),
    observaciones: z.string().optional(),
    observacionesComerciales: z.string().optional(),
    paisDestino: z
      .union([z.string(), z.number()], { error: expecting('un texto ("Brasil") o un número (203)') })
      .optional(),
    pdf: z.boolean().optional(),
    permisoExistente: z.boolean().optional(),
    permisos: z.array(z.string()).optional(),
    puntoVenta: z.number().optional(),
    previsualizar: z.boolean().optional(),
    tipoExpo: z
      .union([z.literal(1), z.literal(2), z.literal(4)], {
        error: expecting('1, 2 o 4', (input) => (EXPORT_TYPE_CODES.includes(input) ? '. Escribilo sin comillas' : '')),
      })
      .optional(),
  })
  .strict();

export type ExportJsonInput = z.infer<typeof exportJsonInputSchema>;

const DEPRECATED_AMOUNT_KEY_WARNING =
  'La clave "monto" del JSON de `--cargar` se saca en la 3.0.0: usá "montoTotal", como en A, B y C.';

/**
 * Nombres de flags (sin guiones) que alguien puede escribir en el JSON pensando que valen igual; los que se parecen a
 * su clave los encuentra la comparacion por parecido. Sin `afecha`: en la E no hay flag y la clave no se usa.
 */
const FLAG_NAME_HINTS: Readonly<Record<string, string>> = {
  ac: 'comprobanteAsociado.atajo',
  acuit: 'comprobanteAsociado.cuit',
  apv: 'comprobanteAsociado.puntoVenta',
  ar: 'comprobanteAsociado.numero',
  at: 'comprobanteAsociado.tipo',
  cm: 'cotizacionMoneda',
  exportarpdf: 'pdf',
  fecha: 'fechaComprobante',
  incotermsdesc: 'descripcionIncoterm',
  mda: 'codigoMoneda',
  monto: 'montoTotal',
  moneda: 'codigoMoneda',
  obscomerciales: 'observacionesComerciales',
  pv: 'puntoVenta',
  sinpdf: 'pdf',
};

const JSON_KEYS: JsonInputKeys = {
  byParent: {
    // `monto` esta deprecada: se acepta, pero no se sugiere.
    '': Object.keys(exportJsonInputSchema.shape).filter((key) => key !== 'monto'),
    comprobanteAsociado: Object.keys(associatedVoucherJsonSchema.shape),
    items: Object.keys(itemJsonSchema.shape),
  },
  flagHints: FLAG_NAME_HINTS,
};

function parseExportJsonInput(value: unknown): ExportJsonInput {
  if (typeof value !== 'object' || value === null) {
    throw new InputValidationError(
      `El JSON de \`--cargar\` de una E tiene que ser un objeto con un comprobante y es ${describeReceived(value)}.`,
    );
  }

  const result = exportJsonInputSchema.safeParse(value, { reportInput: true });

  if (result.success) {
    return result.data;
  }

  throw new InputValidationError(
    `En el JSON de \`--cargar\`: ${result.error.issues
      .flatMap((issue) => describeJsonIssue(issue, JSON_KEYS))
      .map((issue) => issue.mensaje)
      .join(' ')}`,
  );
}

/** `--cargar` toma un solo comprobante; el lote de exportacion queda para mas adelante. */
export function readExportJsonInput(source: unknown): ExportJsonInput {
  if (Array.isArray(source)) {
    throw new InputValidationError(
      'El JSON de `--cargar` de una E tiene que ser un objeto con un comprobante, no un array.',
    );
  }

  const input = parseExportJsonInput(source);

  if (input.monto !== undefined && input.montoTotal !== undefined) {
    throw new InputValidationError('En el JSON de `--cargar`: usá "montoTotal" o "monto", no las dos.');
  }

  return input;
}

/** Los avisos de lo que trae el JSON de `--cargar`. */
export function exportJsonInputWarnings(input: ExportJsonInput | undefined): string[] {
  return input?.monto === undefined ? [] : [DEPRECATED_AMOUNT_KEY_WARNING];
}

export function mapExportJsonItems(items: ExportJsonInput['items']): ExportItemInput[] | undefined {
  return items?.map((item) => ({
    code: item.codigo,
    description: item.descripcion,
    quantity: item.cantidad,
    unit: item.unidad,
    unitPrice: item.precioUnitario,
  }));
}
