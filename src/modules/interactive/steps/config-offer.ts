import type { ArcliConfig } from '../../config/config.schemas';
import type { ExportRepeatState } from '../export-repeat-input';
import { type InvoiceState, isFceInvoiceState } from '../invoice-input';

/** Lo que se ofrece guardar en la config despues de emitir: la pregunta y las claves con su valor. */
export interface ConfigOffer {
  readonly message: string;
  readonly values: ReadonlyArray<readonly [key: string, value: string]>;
}

/**
 * El CBU de la FCE escrito a mano (no habia en la config), con el alias si se escribio, para ofrecer guardarlo. Solo si
 * ARCA autorizo el comprobante (`isAuthorized`, REV-74, #16): como la actividad de la E, un dato que no llego a ARCA no se guarda, porque
 * el asistente no hace nada que el CLI no haga.
 */
export function cbuToSave(
  state: Pick<InvoiceState, 'cbu' | 'cbuAlias' | 'voucherKind'>,
  config: Pick<ArcliConfig, 'aliasCbu' | 'cbu'>,
  authorized: boolean,
): ConfigOffer | undefined {
  const { cbu, cbuAlias } = state;

  if (!authorized || !cbu || config.cbu || !isFceInvoiceState(state)) {
    return undefined;
  }

  // Guardar solo el CBU lo dejaria con el alias que ya esta en la config, que es de otra cuenta.
  if (!cbuAlias && config.aliasCbu) {
    return undefined;
  }

  return {
    message: cbuAlias
      ? `¿Guardamos el CBU y el alias ${cbuAlias} en la config para la próxima?`
      : '¿Guardamos el CBU en la config para la próxima?',
    values: [['cbu', cbu], ...(cbuAlias ? [['aliasCbu', cbuAlias] as const] : [])],
  };
}

/** La actividad de la E escrita a mano (no habia en la config), para ofrecer guardarla: solo si ARCA la autorizo. */
export function activityToSave(
  activity: number | undefined,
  configured: number | undefined,
  authorized: boolean,
): ConfigOffer | undefined {
  return authorized && activity !== undefined && configured === undefined
    ? {
        message: `¿Guardamos la actividad ${activity} en la config para la próxima?`,
        values: [['exportacion.actividad', String(activity)]],
      }
    : undefined;
}

/**
 * Si ARCA autorizo el comprobante: aprobado u observado, con CAE. Un rechazo no es una emision, asi que no se ofrece
 * guardar lo que se escribio a mano (REV-74, #11 y #16).
 */
export function isAuthorized(response: {
  readonly cae: string | null;
  readonly status: 'aprobado' | 'observado' | 'previsualizacion' | 'rechazado';
}): boolean {
  return (response.status === 'aprobado' || response.status === 'observado') && Boolean(response.cae);
}

/**
 * En "Repetir" E, la actividad escrita a mano: solo si la factura no traia una (si no, es la copiada) y como en
 * "Emitir factura" E (`activityToSave`).
 */
export function repeatActivityToSave(
  state: Pick<ExportRepeatState, 'copy' | 'original'>,
  configured: number | undefined,
  authorized: boolean,
): ConfigOffer | undefined {
  return state.original?.activities[0] === undefined
    ? activityToSave(state.copy?.activity, configured, authorized)
    : undefined;
}
