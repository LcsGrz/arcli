import type { ArcliConfig } from '../../config/config.schemas';
import { type InvoiceState, isFceInvoice } from '../invoice-input';

/** Lo que se ofrece guardar en la config despues de emitir: la pregunta y las claves con su valor. */
export interface ConfigOffer {
  readonly message: string;
  readonly values: ReadonlyArray<readonly [key: string, value: string]>;
}

/**
 * El CBU de la FCE escrito a mano (no habia en la config), con el alias si se escribio, para ofrecer guardarlo. Solo si
 * el comprobante se emitio (REV-74, #16): como la actividad de la E, un dato que no llego a ARCA no se guarda, porque
 * el asistente no hace nada que el CLI no haga.
 */
export function cbuToSave(
  state: Pick<InvoiceState, 'cbu' | 'cbuAlias' | 'voucherKind'>,
  config: Pick<ArcliConfig, 'cbu'>,
  emitted: boolean,
): ConfigOffer | undefined {
  const { cbu, cbuAlias } = state;

  if (!emitted || !cbu || config.cbu || !isFceInvoice(state)) {
    return undefined;
  }

  return {
    message: cbuAlias
      ? `¿Guardamos el CBU y el alias ${cbuAlias} en la config para la próxima?`
      : '¿Guardamos el CBU en la config para la próxima?',
    values: [['cbu', cbu], ...(cbuAlias ? [['aliasCbu', cbuAlias] as const] : [])],
  };
}

/** La actividad de la E escrita a mano (no habia en la config), para ofrecer guardarla: solo si se emitio. */
export function activityToSave(
  activity: number | undefined,
  configured: number | undefined,
  emitted: boolean,
): ConfigOffer | undefined {
  return emitted && activity !== undefined && configured === undefined
    ? {
        message: `¿Guardamos la actividad ${activity} en la config para la próxima?`,
        values: [['exportacion.actividad', String(activity)]],
      }
    : undefined;
}
