import { z } from 'zod';

import { InputValidationError } from '../../lib/errors/app-error';

import type { ExportItemInput } from './export.types';

const itemJsonSchema = z
  .object({
    cantidad: z.number(),
    codigo: z.string().optional(),
    descripcion: z.string(),
    precioUnitario: z.number(),
    unidad: z.union([z.string(), z.number()]).optional(),
  })
  .strict();

/**
 * Forma del JSON de `--cargar`: solo tipos y claves. Los valores (importes, pais, incoterm) los valida el
 * servicio igual que si vinieran por flags. Es `.strict()` para que un typo no se ignore en silencio.
 */
export const exportJsonInputSchema = z
  .object({
    actividad: z.number().optional(),
    cliente: z.string().optional(),
    codigoMoneda: z.string().optional(),
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
    numero: z.number().optional(),
    observaciones: z.string().optional(),
    observacionesComerciales: z.string().optional(),
    paisDestino: z.union([z.string(), z.number()]).optional(),
    pdf: z.boolean().optional(),
    permisoExistente: z.boolean().optional(),
    permisos: z.array(z.string()).optional(),
    puntoVenta: z.number().optional(),
    previsualizar: z.boolean().optional(),
    tipoExpo: z.union([z.literal(1), z.literal(2), z.literal(4)]).optional(),
  })
  .strict();

export type ExportJsonInput = z.infer<typeof exportJsonInputSchema>;

const TYPE_LABELS: Readonly<Record<string, string>> = {
  array: 'un array',
  boolean: 'true o false',
  number: 'un numero',
  object: 'un objeto',
  string: 'un texto',
};

function describeIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.map(String).join('.');

  if (issue.code === 'unrecognized_keys') {
    return `La clave "${issue.keys.join('", "')}" no existe en el JSON de --cargar.`;
  }

  if (issue.code === 'invalid_type' && issue.input === undefined) {
    return `Falta "${path}".`;
  }

  if (issue.code === 'invalid_type') {
    return `"${path}" tiene que ser ${TYPE_LABELS[issue.expected] ?? issue.expected}.`;
  }

  return path ? `"${path}": ${issue.message}.` : `${issue.message}.`;
}

export function parseExportJsonInput(value: unknown): ExportJsonInput {
  const result = exportJsonInputSchema.safeParse(value, { reportInput: true });

  if (result.success) {
    return result.data;
  }

  throw new InputValidationError(
    `En el JSON de --cargar: ${result.error.issues.map((issue) => describeIssue(issue)).join(' ')}`,
  );
}

/** `--cargar` toma un solo comprobante; el lote de exportacion queda para mas adelante. */
export function readExportJsonInput(source: unknown): ExportJsonInput {
  if (Array.isArray(source)) {
    throw new InputValidationError(
      'El JSON de --cargar de exportacion tiene que ser un objeto con un comprobante, no un array.',
    );
  }

  return parseExportJsonInput(source);
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
