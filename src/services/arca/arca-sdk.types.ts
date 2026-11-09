/**
 * Los tipos de `@arcasdk/core` que usa el resto de arcli, en un solo lugar: fuera de `services/` nadie importa el SDK
 * (ESLint lo hace cumplir). Si una version del SDK mueve o renombra un tipo, se arregla aca.
 */
export type { Arca, CreateVoucherResultDto, IFEXAuthorizeInput, IFEXAuthorizeOutput } from '@arcasdk/core';

// La raiz del SDK no exporta los tipos del comprobante de wsfe: es la unica ruta interna que se importa.
export type {
  ICbtesAsoc,
  IIva,
  INextVoucher,
  IOpcional,
  IPeriodoAsoc,
  IVoucher,
} from '@arcasdk/core/lib/domain/types/voucher.types';
