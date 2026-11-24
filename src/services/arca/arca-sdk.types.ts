/**
 * Los tipos de `@arcasdk/core` que usa `services/arca`, en un solo lugar: afuera van los propios (ESLint lo hace
 * cumplir). Si una version del SDK mueve o renombra un tipo, se arregla aca.
 */
export type {
  Arca,
  CreateVoucherResultDto,
  IFEXAuthorizeInput,
  IFEXAuthorizeOutput,
  IFEXGetLast_CMPInput,
} from '@arcasdk/core';

// La raiz del SDK no exporta los tipos del comprobante de wsfe: es la unica ruta interna que se importa.
export type { IVoucher } from '@arcasdk/core/lib/domain/types/voucher.types';
