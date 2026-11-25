import { AppError } from '../../lib/errors/app-error';

import type { SentVoucher } from './billing.errors';

/**
 * Como se corta una emision desde afuera (ARQ-11). Nada de esto llega a la llamada que emite: no se cancela, a lo sumo
 * se deja de esperar su respuesta.
 */
export interface EmissionInterruption {
  /** Si se resuelve se deja de esperar a ARCA: lo que se envio queda sin confirmar y no se envia nada mas. */
  readonly abandoned?: Promise<unknown>;
  /** Justo antes de la llamada que emite. Si falla, no se envia. */
  readonly onSending?: (voucher: SentVoucher) => void;
  /** Se mira antes de cada comprobante y otra vez justo antes de enviarlo. */
  readonly shouldStop?: () => boolean;
  /** La primera linea del error de un lote cortado. Sin ella, "Se cortó el lote.". */
  readonly stopMessage?: () => string;
}

/** Se llama justo antes de la llamada que emite, sin nada asincronico en el medio. Si tira, no se envia. */
export type BeforeSending = (voucher: SentVoucher) => void;

/** El motivo de lo que se envio y no se espero. */
export const ABANDONED_REASON = 'se cortó antes de que ARCA contestara';

/** Se corto antes de enviar ese comprobante. */
export class EmissionStoppedError extends AppError {
  public constructor() {
    super('Se cortó antes de enviarlo a ARCA.', { code: 'CANCELLED' });
    this.name = 'EmissionStoppedError';
  }
}
