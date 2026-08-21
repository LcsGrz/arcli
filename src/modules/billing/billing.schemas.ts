import { z } from 'zod';

import type { VoucherShortcut } from './billing.types';

const BILLING_CONCEPT_ALIASES = {
  p: 'productos',
  producto: 'productos',
  productos: 'productos',
  ps: 'productos-servicios',
  'productos-y-servicios': 'productos-servicios',
  'productos-servicios': 'productos-servicios',
  s: 'servicios',
  servicio: 'servicios',
  servicios: 'servicios',
} as const;

export const billingConceptSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') {
      return value;
    }

    const normalizedValue = value.trim().toLowerCase();

    return BILLING_CONCEPT_ALIASES[normalizedValue as keyof typeof BILLING_CONCEPT_ALIASES] ?? value;
  },
  z.enum(['productos', 'productos-servicios', 'servicios']),
);
export const billingDocumentTypeSchema = z.enum(['consumidor-final', 'cuil', 'cuit', 'dni']);
export const billingIvaConditionSchema = z.enum([
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

const billingAssociatedVoucherSchema = z
  .object({
    cuit: z
      .string()
      .trim()
      .regex(/^\d{11}$/)
      .optional(),
    numero: z.number().int().positive().optional(),
    puntoVenta: z.number().int().positive().optional(),
    shortcut: z.string().trim().min(1).optional(),
    tipo: z.number().int().positive().optional(),
  })
  .optional();

export const billingCommandSchema = z.object({
  associatedVoucher: billingAssociatedVoucherSchema,
  billingDate: z.string().trim().optional(),
  concept: billingConceptSchema,
  currencyCode: z.string().trim().length(3).default('ARS'),
  documentNumber: z.number().int().nonnegative().optional(),
  documentType: billingDocumentTypeSchema.default('consumidor-final'),
  dryRun: z.boolean().default(false),
  emit: z.boolean().default(false),
  exchangeRate: z.number().positive().default(1),
  dueDay: z.number().int().min(1).max(31).optional(),
  ivaCondition: billingIvaConditionSchema,
  pointOfSale: z.number().int().positive().optional(),
  serviceEndDate: z.string().trim().optional(),
  serviceStartDate: z.string().trim().optional(),
  shortcut: z
    .string()
    .trim()
    .min(1)
    .transform((value) => value as VoucherShortcut),
  totalAmount: z.number().positive(),
});

export type BillingConcept = z.infer<typeof billingConceptSchema>;
export type BillingDocumentType = z.infer<typeof billingDocumentTypeSchema>;
export type BillingIvaCondition = z.infer<typeof billingIvaConditionSchema>;
export type BillingCommandInput = z.infer<typeof billingCommandSchema>;
