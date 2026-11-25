import { z } from 'zod';

import { InputValidationError } from '../../lib/errors/app-error';
import { describeReceived, jsonInputError, type JsonInputKeys } from '../../lib/json/json-input-issues';
import { associatedVoucherJsonSchema } from '../vouchers/associated-voucher.json-input';

import type { BillingCommandInput } from './billing.schemas';

/**
 * Forma del JSON de `--cargar`, campo por campo. Solo valida tipos y claves: los valores (montos positivos,
 * alicuotas, conceptos...) los revisa despues `billingCommandSchema`, igual que si vinieran por flags.
 * Es `.strict()`: una clave que no esta aca es un error, para que un typo no se ignore en silencio.
 */
const ivaRateJsonSchema = z.union([z.string(), z.number()], {
  error: 'tiene que ser un texto ("general", "10.5") o un número (10.5)',
});

const associatedPeriodJsonSchema = z
  .object({
    desde: z.string().optional(),
    hasta: z.string().optional(),
  })
  .strict();

const ivaRateAmountJsonSchema = z
  .object({
    monto: z.number(),
    tasa: ivaRateJsonSchema,
  })
  .strict();

/** @internal Exportado para los tests. */
export const billingJsonInputSchema = z
  .object({
    aliasCbu: z.string().optional(),
    alicuotaIva: ivaRateJsonSchema.optional(),
    alicuotas: z.array(ivaRateAmountJsonSchema).optional(),
    anulacion: z.boolean().optional(),
    cbu: z.string().optional(),
    codigoMoneda: z.string().optional(),
    comprobanteAsociado: associatedVoucherJsonSchema.optional(),
    concepto: z.string().optional(),
    condicionVenta: z.string().nullable().optional(),
    cotizacionMoneda: z.number().optional(),
    descripcion: z.string().optional(),
    dia: z.number().optional(),
    emitir: z.boolean().optional(),
    fechaComprobante: z.string().optional(),
    importeExento: z.number().optional(),
    importeNoGravado: z.number().optional(),
    ivaReceptor: z.string().optional(),
    mismaMoneda: z.boolean().optional(),
    montoTotal: z.number().optional(),
    numeroDocumento: z.number().optional(),
    pdf: z.boolean().optional(),
    periodoAsociado: associatedPeriodJsonSchema.optional(),
    previsualizar: z.boolean().optional(),
    puntoVenta: z.number().optional(),
    receptorDomicilio: z.string().optional(),
    receptorNombre: z.string().optional(),
    servicioDesde: z.string().optional(),
    servicioHasta: z.string().optional(),
    tipoDocumento: z.string().optional(),
    transferencia: z.string().optional(),
    vencimientoPago: z.string().optional(),
  })
  .strict();

export type BillingJsonInput = z.infer<typeof billingJsonInputSchema>;

type BillingJsonKey = keyof typeof billingJsonInputSchema.shape;

/**
 * Campo de `BillingCommandInput` que alimenta cada clave del JSON; `null` si no tiene uno solo
 * (`emitir` y `previsualizar` deciden juntos `emit` y `dryRun`). El tipo obliga a cubrir todas las claves.
 */
const BILLING_JSON_INTERNAL_KEYS = {
  aliasCbu: 'cbuAlias',
  alicuotaIva: 'ivaRate',
  alicuotas: 'ivaRateAmounts',
  anulacion: 'cancellation',
  cbu: 'cbu',
  codigoMoneda: 'currencyCode',
  comprobanteAsociado: 'associatedVoucher',
  concepto: 'concept',
  condicionVenta: 'saleCondition',
  cotizacionMoneda: 'exchangeRate',
  descripcion: 'pdfDescription',
  dia: 'dueDay',
  emitir: null,
  fechaComprobante: 'billingDate',
  importeExento: 'exemptAmount',
  importeNoGravado: 'untaxedAmount',
  ivaReceptor: 'ivaCondition',
  mismaMoneda: 'sameCurrency',
  montoTotal: 'totalAmount',
  numeroDocumento: 'documentNumber',
  pdf: 'pdf',
  periodoAsociado: 'associatedPeriod',
  previsualizar: null,
  puntoVenta: 'pointOfSale',
  receptorDomicilio: 'receiverAddress',
  receptorNombre: 'receiverName',
  servicioDesde: 'serviceStartDate',
  servicioHasta: 'serviceEndDate',
  tipoDocumento: 'documentType',
  transferencia: 'transferMode',
  vencimientoPago: 'paymentDueDate',
} as const satisfies Record<BillingJsonKey, keyof BillingCommandInput | null>;

/** Clave publica del JSON para cada campo interno; sirve para traducir las rutas de los errores de zod. */
export const BILLING_JSON_KEY_BY_INTERNAL_KEY: Readonly<Record<string, BillingJsonKey>> = Object.fromEntries(
  Object.entries(BILLING_JSON_INTERNAL_KEYS)
    .filter(([, internalKey]) => internalKey !== null)
    .map(([jsonKey, internalKey]) => [internalKey, jsonKey as BillingJsonKey]),
);

/** Lo mismo adentro de un objeto del JSON, por el campo interno que lo contiene; las que no estan se llaman igual. */
export const BILLING_JSON_NESTED_KEY_BY_INTERNAL_KEY: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  associatedVoucher: { shortcut: 'atajo' },
  ivaRateAmounts: { amount: 'monto', rate: 'tasa' },
};

/** Claves validas en cada objeto del JSON; las de un array (`alicuotas`) van sin indice. */
const KEYS_BY_PARENT: Readonly<Record<string, readonly string[]>> = {
  '': Object.keys(billingJsonInputSchema.shape),
  alicuotas: Object.keys(ivaRateAmountJsonSchema.shape),
  comprobanteAsociado: Object.keys(associatedVoucherJsonSchema.shape),
  periodoAsociado: Object.keys(associatedPeriodJsonSchema.shape),
};

/**
 * Nombres de flags (sin guiones) que alguien puede escribir en el JSON pensando que valen igual.
 * Solo los que no se parecen a su clave: el resto lo encuentra la comparacion por parecido.
 */
const FLAG_NAME_HINTS: Readonly<Record<string, string>> = {
  ac: 'comprobanteAsociado.atajo',
  acuit: 'comprobanteAsociado.cuit',
  afecha: 'comprobanteAsociado.fecha',
  alias: 'aliasCbu',
  alicuota: 'alicuotaIva',
  apv: 'comprobanteAsociado.puntoVenta',
  ar: 'comprobanteAsociado.numero',
  at: 'comprobanteAsociado.tipo',
  cm: 'cotizacionMoneda',
  cuil: 'tipoDocumento": "cuil" con "numeroDocumento',
  cuit: 'tipoDocumento": "cuit" con "numeroDocumento',
  dni: 'tipoDocumento": "dni" con "numeroDocumento',
  exento: 'importeExento',
  exportarpdf: 'pdf',
  fecha: 'fechaComprobante',
  ir: 'ivaReceptor',
  mda: 'codigoMoneda',
  moneda: 'codigoMoneda',
  monto: 'montoTotal',
  nogravado: 'importeNoGravado',
  pd: 'periodoAsociado.desde',
  periododesde: 'periodoAsociado.desde',
  periodohasta: 'periodoAsociado.hasta',
  ph: 'periodoAsociado.hasta',
  pv: 'puntoVenta',
  sd: 'servicioDesde',
  sh: 'servicioHasta',
  sinpdf: 'pdf',
  vencimiento: 'vencimientoPago',
  vto: 'vencimientoPago',
};

const JSON_KEYS: JsonInputKeys = { byParent: KEYS_BY_PARENT, flagHints: FLAG_NAME_HINTS };

/**
 * Valida un comprobante del JSON de `--cargar`. Un tipo incorrecto o una clave desconocida es un error de
 * entrada que nombra la clave; antes se descartaban sin aviso y se usaba la config.
 */
export function parseBillingJsonInput(value: unknown): BillingJsonInput {
  const result = billingJsonInputSchema.safeParse(value, { reportInput: true });

  if (result.success) {
    return result.data;
  }

  throw jsonInputError(result.error.issues, JSON_KEYS);
}

/** El JSON de `--cargar` es un comprobante (objeto) o un lote (array no vacio). Devuelve los items sin validar. */
export function readBillingJsonItems(source: unknown): unknown[] {
  if (Array.isArray(source)) {
    if (source.length === 0) {
      throw new InputValidationError('El JSON de `--cargar` es un lote vacío: no hay comprobantes para procesar.');
    }

    return source;
  }

  if (typeof source !== 'object' || source === null) {
    throw new InputValidationError(
      `El JSON de \`--cargar\` tiene que ser un objeto o un array de objetos y es ${describeReceived(source)}.`,
    );
  }

  return [source];
}
