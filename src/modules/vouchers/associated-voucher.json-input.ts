import { z } from 'zod';

/** `comprobanteAsociado` en el JSON de `--cargar`: el comprobante que ajusta una nota, en A, B, C y E. */
export const associatedVoucherJsonSchema = z
  .object({
    atajo: z.string().optional(),
    cuit: z.string().optional(),
    fecha: z.string().optional(),
    numero: z.number().optional(),
    puntoVenta: z.number().optional(),
    tipo: z.number().optional(),
  })
  .strict();
